/**
 * Why the render core fell back to software on a Linux machine, and what to
 * do about it. The core draws through Vulkan only; the usual cause is a GPU
 * whose Vulkan driver is not installed, sometimes a graphics stack too old
 * for the GPU, and on a virtual machine there is no GPU to use at all. Each
 * case ends in the same two ways out: fix the driver, or run the 1.9 line,
 * which draws through Chromium's OpenGL instead.
 *
 * The facts come from electron/linux-gpu-setup.cjs.
 */

export interface LinuxGpu {
  vendor: 'amd' | 'intel' | 'nvidia' | 'other';
  vendorId: string;
  deviceId: string;
  /** Kernel driver bound to it (amdgpu, i915, xe, nvidia, nouveau...), '' when none. */
  driver: string;
}

export interface LinuxGpuSetup {
  distro: { id: string; idLike: string; name: string };
  kernel: string;
  session: string;
  gpus: LinuxGpu[];
  /** Vulkan driver manifests installed (radeon_icd.x86_64.json, lvp_icd...). */
  vulkanDrivers: string[];
  /** What Chromium's OpenGL renders on, e.g. "AMD Radeon 680M (radeonsi, rembrandt...)". */
  glRenderer: string;
}

export type LinuxGpuCause = 'no-vulkan-driver' | 'nvidia-driver' | 'no-kernel-driver' | 'driver-too-old' | 'no-gpu';

export interface LinuxGpuDiagnosis {
  cause: LinuxGpuCause;
  /** One sentence: what was found. */
  finding: string;
  /** What to do, in order; commands are run in a terminal. */
  steps: Array<{ text: string; command?: string }>;
}

/** The 1.9 line: the newest build of the channel for machines 2.x cannot run on. */
export const LEGACY_DOWNLOADS = {
  appImage: 'https://ghostarcade.live/api/download?platform=linux',
  deb: 'https://ghostarcade.live/api/download?platform=linux-deb',
};

const VENDOR_NAME: Record<LinuxGpu['vendor'], string> = { amd: 'AMD', intel: 'Intel', nvidia: 'NVIDIA', other: 'graphics' };
const VULKAN_ICD: Record<string, RegExp> = { amd: /^radeon_icd|^amd_icd|^amdvlk/, intel: /^intel_icd|^intel_hasvk_icd/, nvidia: /^nvidia_icd/ };
const KERNEL_DRIVERS: Record<string, string[]> = { amd: ['amdgpu'], intel: ['i915', 'xe'], nvidia: ['nvidia'] };

type PackageManager = 'apt' | 'dnf' | 'pacman' | 'zypper' | null;

function packageManager(distro: LinuxGpuSetup['distro']): PackageManager {
  const ids = `${distro.id} ${distro.idLike}`.toLowerCase();
  if (/\b(ubuntu|debian|linuxmint|pop|elementary|zorin|neon)\b/.test(ids)) return 'apt';
  if (/\b(fedora|rhel|centos|nobara)\b/.test(ids)) return 'dnf';
  if (/\b(arch|manjaro|endeavouros|cachyos)\b/.test(ids)) return 'pacman';
  if (/\b(opensuse|suse)\b/.test(ids)) return 'zypper';
  return null;
}

function vulkanInstall(vendor: 'amd' | 'intel', pm: PackageManager): string | undefined {
  switch (pm) {
    case 'apt': return 'sudo apt install mesa-vulkan-drivers vulkan-tools';
    case 'dnf': return 'sudo dnf install mesa-vulkan-drivers vulkan-tools';
    case 'pacman': return `sudo pacman -S ${vendor === 'amd' ? 'vulkan-radeon' : 'vulkan-intel'} vulkan-tools`;
    case 'zypper': return `sudo zypper install ${vendor === 'amd' ? 'libvulkan_radeon' : 'libvulkan_intel'} vulkan-tools`;
    default: return undefined;
  }
}

/** The GPU worth fixing: a discrete one before an integrated one. */
function primaryGpu(gpus: LinuxGpu[]): LinuxGpu | null {
  const known = gpus.filter((g) => g.vendor !== 'other');
  return known.find((g) => g.vendor === 'nvidia') ?? known.find((g) => g.vendor === 'amd') ?? known[0] ?? null;
}

/** A readable GPU name: OpenGL's when it reached the hardware, else the vendor. */
function gpuName(setup: LinuxGpuSetup, gpu: LinuxGpu): string {
  const gl = setup.glRenderer.replace(/\s*\(.*$/, '').trim();
  if (gl && !/llvmpipe|softpipe|swiftshader|software/i.test(setup.glRenderer)) return gl;
  return `${VENDOR_NAME[gpu.vendor]} GPU`;
}

export function diagnoseLinuxGpu(setup: LinuxGpuSetup): LinuxGpuDiagnosis {
  const check = { text: 'Check that Vulkan now sees the GPU (it should be named, not "llvmpipe"), then restart Ghost Arcade:', command: 'vulkaninfo --summary' };
  const legacy = { text: 'Or download Ghost Arcade 1.9, which draws through OpenGL and runs on this machine as it is.' };
  const gpu = primaryGpu(setup.gpus);
  const pm = packageManager(setup.distro);
  // Ubuntu LTS ships newer kernels and Mesa as its hardware enablement stack.
  const lts = setup.distro.id === 'ubuntu' ? setup.distro.name.match(/\b(\d{2}\.04)\b/)?.[1] : undefined;
  const update = lts
    ? { text: 'Install Ubuntu\'s newer kernel and graphics stack, then reboot:', command: `sudo apt install --install-recommends linux-generic-hwe-${lts}` }
    : { text: 'Update the system to a current kernel and graphics drivers (Mesa), then reboot.' };

  if (!gpu) {
    return {
      cause: 'no-gpu',
      finding: 'No graphics card was found that Ghost Arcade 2 can use (this is common in a virtual machine).',
      steps: [{ text: 'Download Ghost Arcade 1.9, which runs without one.' }],
    };
  }
  const name = gpuName(setup, gpu);
  const hasVulkan = setup.vulkanDrivers.some((f) => VULKAN_ICD[gpu.vendor]?.test(f));

  if (gpu.vendor === 'nvidia' && (gpu.driver !== 'nvidia' || !hasVulkan)) {
    return {
      cause: 'nvidia-driver',
      finding: `This computer has an ${name}, but it is running ${gpu.driver === 'nouveau' ? 'the open "nouveau" driver, which Ghost Arcade 2 could not use' : 'without NVIDIA\'s driver'}.`,
      steps: [
        { text: 'Install NVIDIA\'s driver, then reboot:', command: pm === 'apt' ? 'sudo ubuntu-drivers install' : undefined },
        check,
        legacy,
      ],
    };
  }
  if (!KERNEL_DRIVERS[gpu.vendor]?.includes(gpu.driver)) {
    return {
      cause: 'no-kernel-driver',
      finding: `This computer has an ${name}, but no graphics driver is loaded for it. The system's kernel is probably older than the GPU (kernel ${setup.kernel}).`,
      steps: [
        update,
        check,
        legacy,
      ],
    };
  }
  if (!hasVulkan) {
    const vendor = gpu.vendor === 'amd' ? 'amd' : 'intel';
    return {
      cause: 'no-vulkan-driver',
      finding: `This computer has an ${name}, but its Vulkan driver is not installed, so Ghost Arcade 2 is drawing in software.`,
      steps: [
        { text: 'Install the Vulkan driver:', command: vulkanInstall(vendor, pm) },
        check,
        legacy,
      ],
    };
  }
  return {
    cause: 'driver-too-old',
    finding: `This computer has an ${name} and a Vulkan driver, but the driver could not use the GPU. The graphics stack is probably older than the GPU (kernel ${setup.kernel}).`,
    steps: [
      update,
      check,
      legacy,
    ],
  };
}
