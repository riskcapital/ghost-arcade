//! What the managed output window has to do for one placement request.
//!
//! Three things went wrong when this was a straight run of window calls:
//!
//! - Closing the output from the editor only hid the window. It stayed
//!   fullscreen and above everything, so the next open started from a
//!   fullscreen window, and winit ignores a fullscreen request that matches
//!   the state it already has.
//! - The new size and position were applied while the window was still
//!   fullscreen; leaving fullscreen afterwards restores the placement saved on
//!   entry, which then overwrote them.
//! - `Fullscreen::Borderless(None)` means "the monitor the window is on now".
//!   A move on Windows is asynchronous, so that was often still the old
//!   display.
//!
//! The plan is pure so the ordering can be tested without a window: leave
//! fullscreen before moving or resizing, enter it with the monitor resolved
//! from the requested rectangle, and drop fullscreen and the raised window
//! level whenever the output detaches.
use serde_json::Value;

use super::{bool_at, number_at, string_at};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CoordinateSpace {
    /// Device-independent units, converted by winit with the scale of the
    /// monitor the window is on at the time. macOS and Linux send these.
    Logical,
    /// Pixels in the desktop's physical coordinate space. Windows sends
    /// these: with displays at different scales, logical units converted with
    /// the current monitor's scale put the window on the wrong display.
    Physical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum LevelPlan {
    Normal,
    AlwaysOnTop,
    AlwaysOnBottom,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum OutputWindowStep {
    LeaveFullscreen,
    SetLevel(LevelPlan),
    SetSize { width: u32, height: u32, space: CoordinateSpace },
    SetPosition { x: f64, y: f64, space: CoordinateSpace },
    /// Index into the monitors the plan was given; None keeps the current one.
    EnterFullscreen { monitor: Option<usize> },
    SetCursorVisible(bool),
    Show,
    Hide,
}

/// A monitor as winit reports it: physical position and size, plus scale.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct MonitorInfo {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(super) struct OutputWindowRequest {
    pub attached: Option<bool>,
    pub fullscreen: Option<bool>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub physical: bool,
    pub always_on_bottom: Option<bool>,
    pub always_on_top: Option<bool>,
}

impl OutputWindowRequest {
    pub(super) fn from_config(config: &Value) -> Self {
        let size = |keys: &[&str]| {
            keys.iter()
                .find_map(|key| number_at(config, &[key]))
                .filter(|value| value.is_finite())
                .map(|value| value.round().clamp(1.0, 32768.0) as u32)
        };
        let coordinate = |keys: &[&str]| {
            keys.iter()
                .find_map(|key| number_at(config, &[key]))
                .filter(|value| value.is_finite())
        };
        Self {
            attached: bool_at(config, &["attached"])
                .or_else(|| bool_at(config, &["visible"]))
                .or_else(|| bool_at(config, &["enabled"])),
            fullscreen: bool_at(config, &["fullscreen"])
                .or_else(|| bool_at(config, &["full_screen"]))
                .or_else(|| bool_at(config, &["borderless"])),
            width: size(&["width", "w"]),
            height: size(&["height", "h"]),
            x: coordinate(&["x", "left"]),
            y: coordinate(&["y", "top"]),
            physical: string_at(config, &["coordinate_space"])
                .is_some_and(|space| space.eq_ignore_ascii_case("physical")),
            always_on_bottom: bool_at(config, &["always_on_bottom"])
                .or_else(|| bool_at(config, &["underlay"])),
            always_on_top: bool_at(config, &["always_on_top"]),
        }
    }

    pub(super) fn detach() -> Self {
        Self { attached: Some(false), ..Self::default() }
    }

    fn space(&self) -> CoordinateSpace {
        if self.physical { CoordinateSpace::Physical } else { CoordinateSpace::Logical }
    }
}

/// The window as the core last left it.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(super) struct OutputWindowState {
    pub attached: bool,
    pub fullscreen: bool,
    /// The monitor it went fullscreen on, when that was resolved.
    pub fullscreen_monitor: Option<MonitorInfo>,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct OutputWindowPlan {
    pub steps: Vec<OutputWindowStep>,
    pub state: OutputWindowState,
}

/// The monitor a rectangle is meant for: the one holding its centre, else the
/// one it overlaps most, else (logical only) the one of exactly its size --
/// a fullscreen request carries the display's own bounds, and logical origins
/// of displays at different scales do not line up with any monitor.
pub(super) fn monitor_for_rect(
    monitors: &[MonitorInfo],
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    space: CoordinateSpace,
) -> Option<usize> {
    let scaled = |monitor: &MonitorInfo| {
        let scale = match space {
            CoordinateSpace::Physical => 1.0,
            CoordinateSpace::Logical => monitor.scale.max(0.1),
        };
        (
            monitor.x as f64 / scale,
            monitor.y as f64 / scale,
            monitor.width as f64 / scale,
            monitor.height as f64 / scale,
        )
    };
    let (cx, cy) = (x + width / 2.0, y + height / 2.0);
    if let Some(index) = monitors.iter().position(|monitor| {
        let (mx, my, mw, mh) = scaled(monitor);
        cx >= mx && cx < mx + mw && cy >= my && cy < my + mh
    }) {
        return Some(index);
    }
    let overlap = |monitor: &MonitorInfo| {
        let (mx, my, mw, mh) = scaled(monitor);
        let w = (x + width).min(mx + mw) - x.max(mx);
        let h = (y + height).min(my + mh) - y.max(my);
        if w > 0.0 && h > 0.0 { w * h } else { 0.0 }
    };
    if let Some((index, _)) = monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| (index, overlap(monitor)))
        .filter(|(_, area)| *area > 0.0)
        .max_by(|a, b| a.1.total_cmp(&b.1))
    {
        return Some(index);
    }
    if space == CoordinateSpace::Logical {
        return monitors.iter().position(|monitor| {
            let (_, _, mw, mh) = scaled(monitor);
            (mw - width).abs() < 1.0 && (mh - height).abs() < 1.0
        });
    }
    None
}

pub(super) fn plan_output_window(
    request: &OutputWindowRequest,
    current: &OutputWindowState,
    monitors: &[MonitorInfo],
) -> OutputWindowPlan {
    let mut steps = Vec::new();
    let attached = request.attached.unwrap_or(current.attached);

    if !attached {
        // A detached output keeps nothing of its show state: not fullscreen,
        // not above other windows, cursor back. Geometry waits for the next
        // open, which brings its own. Leaving is unconditional: it is a no-op
        // for a window that is not fullscreen, and the core's record of the
        // state is not worth trusting over a stale projector window.
        steps.push(OutputWindowStep::LeaveFullscreen);
        steps.push(OutputWindowStep::SetLevel(LevelPlan::Normal));
        steps.push(OutputWindowStep::SetCursorVisible(true));
        steps.push(OutputWindowStep::Hide);
        return OutputWindowPlan {
            steps,
            state: OutputWindowState { attached: false, fullscreen: false, fullscreen_monitor: None },
        };
    }

    let space = request.space();
    let want_fullscreen = request.fullscreen.unwrap_or(current.fullscreen);
    let rect = match (request.x, request.y, request.width, request.height) {
        (Some(x), Some(y), Some(w), Some(h)) => Some((x, y, w as f64, h as f64)),
        _ => None,
    };
    let target = if want_fullscreen {
        rect.and_then(|(x, y, w, h)| monitor_for_rect(monitors, x, y, w, h, space))
    } else {
        None
    };
    let target_monitor = target.and_then(|index| monitors.get(index).copied());
    // Already fullscreen where it is asked to be: touching it would only
    // flicker. Asked for another display, or for a window: leave first, so
    // the restored placement lands before the new geometry, not after it.
    let stays_fullscreen = current.fullscreen
        && want_fullscreen
        && (rect.is_none() || (target_monitor.is_some() && target_monitor == current.fullscreen_monitor));
    let leaves = current.fullscreen && !stays_fullscreen;
    if leaves {
        steps.push(OutputWindowStep::LeaveFullscreen);
    }

    let mut level = None;
    if let Some(bottom) = request.always_on_bottom {
        level = Some(if bottom { LevelPlan::AlwaysOnBottom } else { LevelPlan::Normal });
    } else if let Some(top) = request.always_on_top {
        level = Some(if top { LevelPlan::AlwaysOnTop } else { LevelPlan::Normal });
    }
    if let Some(fullscreen) = request.fullscreen {
        level = Some(if fullscreen { LevelPlan::AlwaysOnTop } else { LevelPlan::Normal });
    }
    if let Some(level) = level {
        steps.push(OutputWindowStep::SetLevel(level));
    }

    if !stays_fullscreen {
        if let (Some(width), Some(height)) = (request.width, request.height) {
            steps.push(OutputWindowStep::SetSize { width, height, space });
        }
        if let (Some(x), Some(y)) = (request.x, request.y) {
            steps.push(OutputWindowStep::SetPosition { x, y, space });
        }
    }

    let fullscreen_monitor = if want_fullscreen && !stays_fullscreen {
        steps.push(OutputWindowStep::EnterFullscreen { monitor: target });
        target_monitor
    } else if stays_fullscreen {
        current.fullscreen_monitor
    } else {
        None
    };
    if let Some(fullscreen) = request.fullscreen {
        steps.push(OutputWindowStep::SetCursorVisible(!fullscreen));
    }
    steps.push(OutputWindowStep::Show);
    OutputWindowPlan {
        steps,
        state: OutputWindowState { attached: true, fullscreen: want_fullscreen, fullscreen_monitor },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // A 150% 4K panel as the primary and a 100% 1080p projector to its right,
    // in physical desktop coordinates.
    const PANEL: MonitorInfo = MonitorInfo { x: 0, y: 0, width: 3840, height: 2160, scale: 1.5 };
    const PROJECTOR: MonitorInfo = MonitorInfo { x: 3840, y: 0, width: 1920, height: 1080, scale: 1.0 };
    const MONITORS: [MonitorInfo; 2] = [PANEL, PROJECTOR];

    fn index_of(steps: &[OutputWindowStep], wanted: impl Fn(&OutputWindowStep) -> bool) -> usize {
        steps.iter().position(wanted).expect("step present")
    }

    #[test]
    fn detaching_from_the_editor_leaves_fullscreen_and_the_raised_level() {
        let current = OutputWindowState { attached: true, fullscreen: true, fullscreen_monitor: Some(PROJECTOR) };
        // OutputWindow.svelte close() sends only this.
        let request = OutputWindowRequest::from_config(&json!({ "attached": false, "visible": false }));
        let plan = plan_output_window(&request, &current, &MONITORS);
        assert_eq!(
            plan.steps,
            vec![
                OutputWindowStep::LeaveFullscreen,
                OutputWindowStep::SetLevel(LevelPlan::Normal),
                OutputWindowStep::SetCursorVisible(true),
                OutputWindowStep::Hide,
            ]
        );
        assert_eq!(plan.state, OutputWindowState { attached: false, fullscreen: false, fullscreen_monitor: None });
        // The next windowed open starts from a plain window.
        let reopen = OutputWindowRequest::from_config(&json!({
            "attached": true, "fullscreen": false, "x": 100, "y": 100, "width": 1280, "height": 720,
        }));
        let plan = plan_output_window(&reopen, &plan.state, &MONITORS);
        assert!(!plan.steps.contains(&OutputWindowStep::LeaveFullscreen));
        assert!(!plan.steps.iter().any(|step| matches!(step, OutputWindowStep::EnterFullscreen { .. })));
    }

    #[test]
    fn esc_and_the_close_button_detach_the_same_way() {
        for fullscreen in [true, false] {
            let current = OutputWindowState { attached: true, fullscreen, fullscreen_monitor: None };
            let plan = plan_output_window(&OutputWindowRequest::detach(), &current, &[]);
            assert_eq!(plan.steps[0], OutputWindowStep::LeaveFullscreen);
            assert!(plan.steps.contains(&OutputWindowStep::SetLevel(LevelPlan::Normal)));
            assert!(!plan.state.fullscreen && !plan.state.attached);
        }
    }

    #[test]
    fn fullscreen_is_left_before_the_window_is_moved_or_resized() {
        let current = OutputWindowState { attached: true, fullscreen: true, fullscreen_monitor: Some(PROJECTOR) };
        let request = OutputWindowRequest::from_config(&json!({
            "attached": true, "fullscreen": false, "x": 4160, "y": 180, "width": 1280, "height": 720,
            "coordinate_space": "physical",
        }));
        let plan = plan_output_window(&request, &current, &MONITORS);
        let leave = index_of(&plan.steps, |s| *s == OutputWindowStep::LeaveFullscreen);
        let size = index_of(&plan.steps, |s| matches!(s, OutputWindowStep::SetSize { .. }));
        let position = index_of(&plan.steps, |s| matches!(s, OutputWindowStep::SetPosition { .. }));
        assert!(leave < size && leave < position);
        assert_eq!(
            plan.steps[size],
            OutputWindowStep::SetSize { width: 1280, height: 720, space: CoordinateSpace::Physical }
        );
        assert_eq!(*plan.steps.last().unwrap(), OutputWindowStep::Show);
        assert!(!plan.state.fullscreen);
    }

    #[test]
    fn fullscreen_enters_on_the_monitor_of_the_requested_rect() {
        let current = OutputWindowState { attached: false, fullscreen: false, fullscreen_monitor: None };
        let request = OutputWindowRequest::from_config(&json!({
            "attached": true, "fullscreen": true, "x": 3840, "y": 0, "width": 1920, "height": 1080,
            "coordinate_space": "physical",
        }));
        let plan = plan_output_window(&request, &current, &MONITORS);
        let position = index_of(&plan.steps, |s| matches!(s, OutputWindowStep::SetPosition { .. }));
        let enter = index_of(&plan.steps, |s| matches!(s, OutputWindowStep::EnterFullscreen { .. }));
        assert!(position < enter);
        assert_eq!(plan.steps[enter], OutputWindowStep::EnterFullscreen { monitor: Some(1) });
        assert!(plan.steps.contains(&OutputWindowStep::SetLevel(LevelPlan::AlwaysOnTop)));
        assert!(plan.steps.contains(&OutputWindowStep::SetCursorVisible(false)));
        assert_eq!(plan.state.fullscreen_monitor, Some(PROJECTOR));
    }

    #[test]
    fn moving_a_fullscreen_output_to_another_display_leaves_and_re_enters() {
        let current = OutputWindowState { attached: true, fullscreen: true, fullscreen_monitor: Some(PANEL) };
        let request = OutputWindowRequest::from_config(&json!({
            "attached": true, "fullscreen": true, "x": 3840, "y": 0, "width": 1920, "height": 1080,
            "coordinate_space": "physical",
        }));
        let plan = plan_output_window(&request, &current, &MONITORS);
        assert_eq!(plan.steps[0], OutputWindowStep::LeaveFullscreen);
        assert!(plan.steps.contains(&OutputWindowStep::EnterFullscreen { monitor: Some(1) }));
    }

    #[test]
    fn re_sending_the_same_fullscreen_placement_does_not_flicker() {
        let current = OutputWindowState { attached: true, fullscreen: true, fullscreen_monitor: Some(PROJECTOR) };
        let request = OutputWindowRequest::from_config(&json!({
            "attached": true, "fullscreen": true, "x": 3840, "y": 0, "width": 1920, "height": 1080,
            "coordinate_space": "physical",
        }));
        let plan = plan_output_window(&request, &current, &MONITORS);
        assert!(!plan.steps.contains(&OutputWindowStep::LeaveFullscreen));
        assert!(!plan.steps.iter().any(|s| matches!(
            s,
            OutputWindowStep::EnterFullscreen { .. } | OutputWindowStep::SetSize { .. } | OutputWindowStep::SetPosition { .. }
        )));
        assert_eq!(plan.state.fullscreen_monitor, Some(PROJECTOR));
    }

    #[test]
    fn monitors_resolve_from_physical_rects_across_scales() {
        assert_eq!(monitor_for_rect(&MONITORS, 3840.0, 0.0, 1920.0, 1080.0, CoordinateSpace::Physical), Some(1));
        assert_eq!(monitor_for_rect(&MONITORS, 0.0, 0.0, 3840.0, 2160.0, CoordinateSpace::Physical), Some(0));
        // A window straddling both goes where most of it is.
        assert_eq!(monitor_for_rect(&MONITORS, 3000.0, 1500.0, 1000.0, 1000.0, CoordinateSpace::Physical), Some(0));
        assert_eq!(monitor_for_rect(&MONITORS, -5000.0, 0.0, 100.0, 100.0, CoordinateSpace::Physical), None);
    }

    #[test]
    fn logical_display_bounds_still_find_their_monitor_by_size() {
        // Electron lays the 100% projector out right of the panel's 2560 DIP
        // width, while its physical origin over its own scale is 3840: no
        // monitor holds the rect's centre, and it is still found.
        assert_eq!(monitor_for_rect(&MONITORS, 2560.0, 0.0, 1920.0, 1080.0, CoordinateSpace::Logical), Some(1));
        // With nothing overlapping, the display's own size names it.
        let far = [PANEL, MonitorInfo { x: 9000, ..PROJECTOR }];
        assert_eq!(monitor_for_rect(&far, 2560.0, 0.0, 1920.0, 1080.0, CoordinateSpace::Logical), Some(1));
        assert_eq!(monitor_for_rect(&MONITORS, 0.0, 0.0, 2560.0, 1440.0, CoordinateSpace::Logical), Some(0));
    }

    #[test]
    fn a_title_only_update_keeps_the_window_as_it_is() {
        let current = OutputWindowState { attached: true, fullscreen: true, fullscreen_monitor: Some(PROJECTOR) };
        let plan = plan_output_window(&OutputWindowRequest::from_config(&json!({ "title": "Out" })), &current, &MONITORS);
        assert_eq!(plan.steps, vec![OutputWindowStep::Show]);
        assert_eq!(plan.state, current);
    }

    #[test]
    fn requests_parse_the_coordinate_space() {
        let logical = OutputWindowRequest::from_config(&json!({ "x": 1, "y": 2, "width": 3, "height": 4 }));
        assert!(!logical.physical);
        let physical = OutputWindowRequest::from_config(&json!({ "coordinate_space": "physical", "w": 3, "h": 4 }));
        assert!(physical.physical);
        assert_eq!((physical.width, physical.height), (Some(3), Some(4)));
    }
}
