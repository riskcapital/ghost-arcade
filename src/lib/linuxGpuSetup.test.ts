/**
 * The Linux GPU check names the cause a user can act on and the command for
 * their distribution, and always leaves 1.9 as the way out.
 */
import { describe, expect, it } from 'vitest';
import { diagnoseLinuxGpu, type LinuxGpuSetup } from './linuxGpuSetup';

const ubuntu = { id: 'ubuntu', idLike: 'debian', name: 'Ubuntu 22.04.4 LTS' };
const radeon680m = { vendor: 'amd' as const, vendorId: '0x1002', deviceId: '0x1681', driver: 'amdgpu' };

function setup(overrides: Partial<LinuxGpuSetup>): LinuxGpuSetup {
  return {
    distro: ubuntu,
    kernel: '5.15.0-91-generic',
    session: 'x11',
    gpus: [radeon680m],
    vulkanDrivers: ['lvp_icd.x86_64.json'],
    glRenderer: 'AMD Radeon 680M (radeonsi, rembrandt, LLVM 15.0.7, DRM 3.42, 5.15.0-91-generic)',
    ...overrides,
  };
}

const commands = (d: ReturnType<typeof diagnoseLinuxGpu>) => d.steps.map((s) => s.command).filter(Boolean);
const offersLegacy = (d: ReturnType<typeof diagnoseLinuxGpu>) => d.steps.some((s) => /Ghost Arcade 1\.9/.test(s.text));

describe('Linux GPU check', () => {
  it('a Radeon 680M with only the software Vulkan driver: install mesa-vulkan-drivers', () => {
    const d = diagnoseLinuxGpu(setup({}));
    expect(d.cause).toBe('no-vulkan-driver');
    expect(d.finding).toContain('AMD Radeon 680M');
    expect(commands(d)).toEqual(['sudo apt install mesa-vulkan-drivers vulkan-tools', 'vulkaninfo --summary']);
    expect(offersLegacy(d)).toBe(true);
  });

  it('names the package for each distribution family', () => {
    const fedora = diagnoseLinuxGpu(setup({ distro: { id: 'fedora', idLike: '', name: 'Fedora Linux 40' } }));
    expect(commands(fedora)[0]).toBe('sudo dnf install mesa-vulkan-drivers vulkan-tools');
    const arch = diagnoseLinuxGpu(setup({ distro: { id: 'arch', idLike: '', name: 'Arch Linux' } }));
    expect(commands(arch)[0]).toBe('sudo pacman -S vulkan-radeon vulkan-tools');
    const intelArch = diagnoseLinuxGpu(setup({
      distro: { id: 'manjaro', idLike: 'arch', name: 'Manjaro Linux' },
      gpus: [{ vendor: 'intel', vendorId: '0x8086', deviceId: '0x46a6', driver: 'i915' }],
      glRenderer: 'Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2)',
    }));
    expect(commands(intelArch)[0]).toBe('sudo pacman -S vulkan-intel vulkan-tools');
  });

  it('a Vulkan driver that is installed but cannot use the GPU: update the stack (HWE on Ubuntu LTS)', () => {
    const d = diagnoseLinuxGpu(setup({ vulkanDrivers: ['lvp_icd.x86_64.json', 'radeon_icd.x86_64.json'] }));
    expect(d.cause).toBe('driver-too-old');
    expect(commands(d)[0]).toBe('sudo apt install --install-recommends linux-generic-hwe-22.04');
    expect(offersLegacy(d)).toBe(true);
  });

  it('no kernel driver bound to the GPU: the kernel is older than the GPU', () => {
    const d = diagnoseLinuxGpu(setup({ gpus: [{ ...radeon680m, driver: '' }], glRenderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' }));
    expect(d.cause).toBe('no-kernel-driver');
    // OpenGL is in software too, so the GPU is named by vendor.
    expect(d.finding).toContain('an AMD GPU');
    expect(d.finding).toContain('5.15.0-91-generic');
  });

  it('NVIDIA on nouveau: install NVIDIA\'s driver', () => {
    const d = diagnoseLinuxGpu(setup({
      gpus: [{ vendor: 'nvidia', vendorId: '0x10de', deviceId: '0x2520', driver: 'nouveau' }],
      glRenderer: 'NVA6',
    }));
    expect(d.cause).toBe('nvidia-driver');
    expect(d.finding).toContain('nouveau');
    expect(commands(d)[0]).toBe('sudo ubuntu-drivers install');
  });

  it('a hybrid laptop is diagnosed on its NVIDIA GPU', () => {
    const d = diagnoseLinuxGpu(setup({
      gpus: [{ vendor: 'intel', vendorId: '0x8086', deviceId: '0x46a6', driver: 'i915' }, { vendor: 'nvidia', vendorId: '0x10de', deviceId: '0x2520', driver: 'nouveau' }],
    }));
    expect(d.cause).toBe('nvidia-driver');
  });

  it('no GPU at all (a virtual machine): 1.9 is the answer', () => {
    const d = diagnoseLinuxGpu(setup({ gpus: [{ vendor: 'other', vendorId: '0x1234', deviceId: '0x1111', driver: 'bochs-drm' }], glRenderer: 'llvmpipe' }));
    expect(d.cause).toBe('no-gpu');
    expect(offersLegacy(d)).toBe(true);
  });

  it('an unknown distribution still gets the steps, without a command it cannot know', () => {
    const d = diagnoseLinuxGpu(setup({ distro: { id: 'gentoo', idLike: '', name: 'Gentoo' } }));
    expect(d.cause).toBe('no-vulkan-driver');
    expect(d.steps[0].command).toBeUndefined();
    expect(offersLegacy(d)).toBe(true);
  });
});
