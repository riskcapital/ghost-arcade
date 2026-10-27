//! The exact refresh rate of a display on Windows.
//!
//! winit reads a monitor's rate from EnumDisplaySettings, whose
//! dmDisplayFrequency is a whole number: a 59.94 Hz TV, projector or HDMI
//! mode reads as 59, a 143.86 Hz panel as 143. Frames paced to 59 on a
//! 59.94 Hz display repeat one every second or so. QueryDisplayConfig keeps
//! the rate as a fraction (60000/1001), so it is asked first.

use windows::Win32::Devices::Display::{
    DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig, DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
    DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SOURCE_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
};

/// The refresh rate of the active display whose GDI device name (winit's
/// `MonitorHandleExtWindows::native_id`, "\\.\DISPLAY1") is `gdi_device_name`,
/// or None when Windows does not say.
pub(crate) fn exact_refresh_hz(gdi_device_name: &str) -> Option<f64> {
    let mut path_count = 0u32;
    let mut mode_count = 0u32;
    // SAFETY: plain out-parameters; the arrays are sized from the counts the
    // first call returns, and QueryDisplayConfig writes back how many it used.
    unsafe {
        GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count).ok().ok()?;
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
        QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut path_count,
            paths.as_mut_ptr(),
            &mut mode_count,
            modes.as_mut_ptr(),
            None,
        )
        .ok()
        .ok()?;
        paths.truncate(path_count as usize);
        for path in &paths {
            let mut source = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
            source.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
            source.header.size = std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
            source.header.adapterId = path.sourceInfo.adapterId;
            source.header.id = path.sourceInfo.id;
            if DisplayConfigGetDeviceInfo(&mut source.header) != 0 {
                continue;
            }
            if !gdi_name(&source.viewGdiDeviceName).eq_ignore_ascii_case(gdi_device_name) {
                continue;
            }
            return rational_hz(path.targetInfo.refreshRate.Numerator, path.targetInfo.refreshRate.Denominator);
        }
    }
    None
}

fn gdi_name(raw: &[u16]) -> String {
    let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
    String::from_utf16_lossy(&raw[..len])
}

/// A rate given as a fraction, if it is one a display could run at.
fn rational_hz(numerator: u32, denominator: u32) -> Option<f64> {
    if numerator == 0 || denominator == 0 {
        return None;
    }
    let hz = numerator as f64 / denominator as f64;
    (hz.is_finite() && (20.0..=500.0).contains(&hz)).then_some(hz)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_fractional_rates_and_rejects_unset_ones() {
        assert!((rational_hz(60000, 1001).unwrap() - 59.94).abs() < 0.001);
        assert_eq!(rational_hz(144, 1), Some(144.0));
        assert_eq!(rational_hz(0, 0), None);
        assert_eq!(rational_hz(1, 0), None);
    }

    #[test]
    fn reads_gdi_names_up_to_the_terminator() {
        let mut raw = [0u16; 32];
        for (slot, c) in raw.iter_mut().zip(r"\\.\DISPLAY1".encode_utf16()) {
            *slot = c;
        }
        assert_eq!(gdi_name(&raw), r"\\.\DISPLAY1");
    }

    #[test]
    fn an_unknown_display_has_no_rate() {
        assert_eq!(exact_refresh_hz(r"\\.\NO-SUCH-DISPLAY"), None);
    }

    #[test]
    fn every_attached_display_reports_a_usable_rate() {
        // A machine with no display (a CI runner) finds none, which is fine.
        for index in 1..=16 {
            let name = format!(r"\\.\DISPLAY{index}");
            if let Some(hz) = exact_refresh_hz(&name) {
                println!("{name}: {hz:.3} Hz");
                assert!((20.0..=500.0).contains(&hz));
            }
        }
    }
}
