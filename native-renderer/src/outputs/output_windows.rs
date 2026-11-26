//! Output windows: parenting into the app's windows (AppKit), fullscreen,
//! monitor placement and detaching.

use crate::*;

pub(crate) fn decode_hex_pointer_le(hex: &str) -> Option<usize> {
    let clean = hex.trim();
    if clean.is_empty() || clean.len() % 2 != 0 {
        return None;
    }
    let mut value: usize = 0;
    let max_bytes = std::mem::size_of::<usize>();
    for (index, offset) in (0..clean.len()).step_by(2).take(max_bytes).enumerate() {
        let byte = u8::from_str_radix(&clean[offset..offset + 2], 16).ok()? as usize;
        value |= byte << (index * 8);
    }
    if value == 0 { None } else { Some(value) }
}

pub(crate) fn appkit_parent_window_handle(hex: &str) -> Option<RawWindowHandle> {
    let ptr = decode_hex_pointer_le(hex)? as *mut c_void;
    let ns_view = NonNull::new(ptr)?;
    Some(RawWindowHandle::AppKit(AppKitWindowHandle::new(ns_view)))
}

#[cfg(target_os = "macos")]
pub(crate) fn appkit_window_for_raw_handle(handle: RawWindowHandle) -> Option<Retained<NSWindow>> {
    let RawWindowHandle::AppKit(handle) = handle else {
        return None;
    };
    // SAFETY: The caller supplied a live AppKit NSView handle. We retain it
    // only long enough to ask AppKit for the owning NSWindow.
    let view: Retained<NSView> = unsafe { Retained::retain(handle.ns_view.as_ptr().cast()) }?;
    view.window()
}

#[cfg(target_os = "macos")]
pub(crate) fn promote_appkit_child_window_to_underlay(
    parent_handle: RawWindowHandle,
    child_window: &Window,
) -> bool {
    let Some(parent_window) = appkit_window_for_raw_handle(parent_handle) else {
        return false;
    };
    let Ok(child_handle) = child_window.window_handle() else {
        return false;
    };
    let Some(child_ns_window) = appkit_window_for_raw_handle(child_handle.as_raw()) else {
        return false;
    };

    // Winit creates AppKit child windows ordered above the parent. For the
    // editor preview, the render surface must live below Electron's transparent
    // content window so DOM controls, warp handles, modals, and hit-testing all
    // remain owned by the UI layer while the pixels come from the native core.
    unsafe {
        parent_window.removeChildWindow(&child_ns_window);
        parent_window.addChildWindow_ordered(&child_ns_window, NSWindowOrderingMode::NSWindowBelow);
    }
    child_ns_window.setIgnoresMouseEvents(true);
    true
}

#[cfg(target_os = "macos")]
pub(crate) fn activate_appkit_output_window(window: &Window) {
    let Ok(handle) = window.window_handle() else {
        return;
    };
    let Some(ns_window) = appkit_window_for_raw_handle(handle.as_raw()) else {
        return;
    };
    // SAFETY: native renderer window management runs on winit's macOS event
    // loop thread. The NSWindow is owned by winit for the process lifetime.
    unsafe {
        ns_window.orderFrontRegardless();
    }
    ns_window.makeKeyAndOrderFront(None);
    if let Some(marker) = MainThreadMarker::new() {
        let app = NSApplication::sharedApplication(marker);
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn activate_appkit_output_window(_window: &Window) {}

#[cfg(target_os = "macos")]
pub(crate) fn set_managed_output_fullscreen(window: &Window, fullscreen: bool, _monitor: Option<MonitorHandle>) {
    // Projector output must stay in the current macOS workspace. Winit's
    // Borderless fullscreen enters an asynchronous Space transition, which can
    // leave a renderer owned by a helper process occluded behind Electron. The
    // caller already supplies the target display's exact x/y/width/height, so a
    // borderless top-level window is the correct fullscreen primitive here.
    window.set_fullscreen(None);
    window.set_decorations(!fullscreen);
    if let Ok(handle) = window.window_handle() {
        if let Some(ns_window) = appkit_window_for_raw_handle(handle.as_raw()) {
            // Presentation options stop hiding system chrome when the editor (or
            // another application) becomes active. Keep the dedicated projector
            // above both the menu (24) and its status items (25), without raising
            // the editor or entering a separate fullscreen Space.
            ns_window.setLevel(if fullscreen { NSStatusWindowLevel + 1 } else { NSNormalWindowLevel });
            // SAFETY: all managed output changes run on the AppKit event thread.
            unsafe {
                ns_window.setHidesOnDeactivate(false);
                ns_window.setCollectionBehavior(if fullscreen {
                    NSWindowCollectionBehavior::CanJoinAllSpaces
                        | NSWindowCollectionBehavior::Stationary
                        | NSWindowCollectionBehavior::IgnoresCycle
                        | NSWindowCollectionBehavior::FullScreenAuxiliary
                } else {
                    NSWindowCollectionBehavior::Default
                });
            }
            if fullscreen {
                if let Some(screen) = ns_window.screen() {
                    // AppKit's full frame includes the menu/Dock area. Using the
                    // visible frame here would leave a strip of desktop exposed.
                    ns_window.setFrame_display(screen.frame(), true);
                }
            }
        }
    }
    // No NSApplication presentation options: hiding the Dock and menu bar
    // took them away from the main screen too whenever this process was
    // active. The window level above covers both on the projector's own
    // display.
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn set_managed_output_fullscreen(window: &Window, fullscreen: bool, monitor: Option<MonitorHandle>) {
    // An explicit monitor: `None` means the one the window is on right now,
    // and a move on Windows has not necessarily landed yet.
    window.set_fullscreen(if fullscreen {
        Some(Fullscreen::Borderless(monitor))
    } else {
        None
    });
}

/// The monitors winit knows, with the physical rects the placement plan
/// matches requests against.
pub(crate) fn output_window_monitors(window: &Window) -> (Vec<MonitorHandle>, Vec<MonitorInfo>) {
    let handles: Vec<MonitorHandle> = window.available_monitors().collect();
    let infos = handles
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            MonitorInfo {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                scale: monitor.scale_factor(),
            }
        })
        .collect();
    (handles, infos)
}

pub(crate) fn apply_output_window_steps(window: &Window, steps: &[OutputWindowStep], monitors: &[MonitorHandle]) {
    use output_window_plan::CoordinateSpace;
    for step in steps {
        match *step {
            OutputWindowStep::LeaveFullscreen => set_managed_output_fullscreen(window, false, None),
            OutputWindowStep::SetLevel(level) => window.set_window_level(match level {
                LevelPlan::Normal => WindowLevel::Normal,
                LevelPlan::AlwaysOnTop => WindowLevel::AlwaysOnTop,
                LevelPlan::AlwaysOnBottom => WindowLevel::AlwaysOnBottom,
            }),
            OutputWindowStep::SetSize { width, height, space } => {
                let _ = match space {
                    CoordinateSpace::Physical => window.request_inner_size(PhysicalSize::new(width, height)),
                    CoordinateSpace::Logical => {
                        window.request_inner_size(LogicalSize::new(width as f64, height as f64))
                    }
                };
            }
            OutputWindowStep::SetPosition { x, y, space } => match space {
                CoordinateSpace::Physical => window
                    .set_outer_position(PhysicalPosition::new(x.round() as i32, y.round() as i32)),
                CoordinateSpace::Logical => window.set_outer_position(LogicalPosition::new(x, y)),
            },
            OutputWindowStep::EnterFullscreen { monitor } => set_managed_output_fullscreen(
                window,
                true,
                monitor.and_then(|index| monitors.get(index).cloned()),
            ),
            OutputWindowStep::SetCursorVisible(visible) => window.set_cursor_visible(visible),
            OutputWindowStep::Show => {
                window.set_visible(true);
                window.focus_window();
                activate_appkit_output_window(window);
                window.request_redraw();
            }
            OutputWindowStep::Hide => window.set_visible(false),
        }
    }
}

/// Esc, the close button and a detach from the editor all end the same way.
pub(crate) fn detach_managed_output_window(window: &Window, placement: &OutputWindowState) -> OutputWindowState {
    let plan = plan_output_window(&OutputWindowRequest::detach(), placement, &[]);
    apply_output_window_steps(window, &plan.steps, &[]);
    plan.state
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn promote_appkit_child_window_to_underlay(
    _parent_handle: RawWindowHandle,
    _child_window: &Window,
) -> bool {
    false
}

impl App {
    pub(crate) fn apply_output_window_attached(&mut self, attached: bool) {
        self.output_window_attached = attached;
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.pacing.reset();
        }
        if !attached {
            if let Some(renderer) = self.renderer.as_ref() {
                self.output_window_placement =
                    detach_managed_output_window(&renderer.window, &self.output_window_placement);
            }
            return;
        }
        self.output_window_placement.attached = true;
        if let Some(renderer) = self.renderer.as_ref() {
            renderer.window.set_visible(attached);
            if attached {
                // A newly shown winit window can remain entirely behind the
                // Electron editor on a single display. Metal then reports an
                // occluded swapchain and the UI cannot distinguish that from
                // a broken output. Raise it once on attach; normal window
                // ordering resumes as soon as the user focuses the editor.
                renderer.window.focus_window();
                activate_appkit_output_window(&renderer.window);
                renderer.window.request_redraw();
            }
        }
        self.refresh_output_display_rate();
    }

    pub(crate) fn apply_output_window_config(&mut self, params: &Value) {
        let config = params.get("config").unwrap_or(params);
        let request = OutputWindowRequest::from_config(config);
        if let Some(attached) = request.attached {
            self.output_window_attached = attached;
        }
        if let Some(fullscreen) = request.fullscreen {
            self.output_window_fullscreen = fullscreen;
        }
        // A fullscreen output shows the project's composite at the display's
        // size; the composite itself stays the project's.
        let keep_project_size = self.output_size_configured && self.output_window_fullscreen;
        if let (Some(width), Some(height)) = (request.width, request.height)
            && !keep_project_size
        {
            self.pending_width = width;
            self.pending_height = height;
        }

        let Some(renderer) = self.renderer.as_ref() else {
            return;
        };
        if let Some(title) = string_at(config, &["title"]).or_else(|| string_at(config, &["label"]))
        {
            renderer.window.set_title(&title);
        }
        if let Some(resizable) = bool_at(config, &["resizable"]) {
            renderer.window.set_resizable(resizable);
        }
        if let Some(decorations) =
            bool_at(config, &["decorations"]).or_else(|| bool_at(config, &["decorated"]))
        {
            renderer.window.set_decorations(decorations);
        }
        if let Some(cursor_hittest) =
            bool_at(config, &["cursor_hittest"]).or_else(|| bool_at(config, &["input_enabled"]))
        {
            let _ = renderer.window.set_cursor_hittest(cursor_hittest);
        }
        if let Some(input_transparent) =
            bool_at(config, &["input_transparent"]).or_else(|| bool_at(config, &["click_through"]))
        {
            let _ = renderer.window.set_cursor_hittest(!input_transparent);
        }
        // Level, fullscreen, size, position and visibility, in the order that
        // survives winit: see output_window_plan.
        let (monitor_handles, monitors) = output_window_monitors(&renderer.window);
        let current = OutputWindowState {
            attached: self.output_window_attached,
            ..self.output_window_placement
        };
        let plan = plan_output_window(&request, &current, &monitors);
        apply_output_window_steps(&renderer.window, &plan.steps, &monitor_handles);
        self.output_window_placement = plan.state;
        self.refresh_output_display_rate();
    }
}
