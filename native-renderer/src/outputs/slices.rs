//! Screens (slice outputs): their targets and render pass, Linux Screen
//! windows, Map Sim projector views and slice metadata.

use crate::*;

impl RenderState {
    /// Create (or resize) one slice display's offscreen target and, where the
    /// platform has one, its shared-texture export.
    pub(crate) fn ensure_slice_target(&mut self, id: &str, width: u32, height: u32) -> bool {
        if let Some(existing) = self.slice_targets.get(id) {
            if existing.size() == (width, height) {
                return true;
            }
        }
        let (render_texture, render_view) = Self::create_offscreen_target(
            &self.device,
            width,
            height,
            self.config.format,
            "Ghost Slice Output Render Target",
        );
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        let export = match Self::create_output_export_target(
            &self.device,
            width,
            height,
            native_output_export_format(self.config.format),
        ) {
            Ok(export) => export,
            Err(err) => {
                eprintln!("[ghost-core] slice output export target failed: {err}");
                self.slice_targets.remove(id);
                return false;
            }
        };
        self.slice_targets.insert(
            id.to_string(),
            SliceOutputTarget {
                _render_texture: render_texture,
                render_view,
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                export,
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                width,
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                height,
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                frame: 0,
                projector_view_source: None,
            },
        );
        true
    }

    /// Composite one full frame per slice display. Each pass re-runs the
    /// compositor with that slice's output stage, so the projector gets its
    /// region rendered at the display's own resolution rather than a crop of
    /// a downscaled master — the reason this is a second composite rather
    /// than a blit.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn render_slice_outputs(
        &mut self,
        command_phase: f32,
        time_seconds: Option<f32>,
        frame_count: u64,
        layers: &[LayerGpu],
        audio0: [f32; 4],
        audio1: [f32; 4],
        audio2: [f32; 4],
        output_gate: f32,
        post_effects: &[[f32; 4]],
        specs: &[SliceOutputSpec],
        allow_direct: bool,
        projector_views: &ProjectorViewInputs<'_>,
    ) {
        // Drop targets for slices the editor has closed so their shared
        // textures (and the VRAM behind them) don't leak across a session.
        let live: std::collections::HashSet<&str> =
            specs.iter().map(|spec| spec.id.as_str()).collect();
        self.slice_targets.retain(|id, _| live.contains(id.as_str()));

        for spec in specs {
            if !self.ensure_slice_target(&spec.id, spec.width, spec.height) {
                continue;
            }
            if let Some(projector_id) = spec.projector_view.as_deref() {
                self.render_projector_view_slice(spec, projector_id, projector_views, output_gate, time_seconds);
                continue;
            }
            let needs_detail = spec.width as f32 > self.config.width as f32 * spec.stage.out0[2]
                || spec.height as f32 > self.config.height as f32 * spec.stage.out0[3]
                || spec.stage.swarp[0] > 0.5 || spec.stage.mwarp[0] > 0.5;
            // Flux resamples the finished picture, so a Screen must take the shared master while it plays.
            // So must every Screen of a dome with layers placed on it: they are
            // laid over the dome by the output stage.
            let direct = allow_direct && needs_detail && self.output_flux[0][3] <= 0.0005
                && self.dome_layer_pass[0] < 0.5 && spec.mirror_mesh.is_none()
                && spec.stage.dproj0[0] < 0.5;
            if let Some(mesh) = spec.mirror_mesh.as_ref() {
                self.prepare_mirror_mesh(mesh);
            }
            // A full-detail Screen composites the program's layers (already
            // uploaded this frame) with its own output stage.
            let view_key = format!("slice:{}", spec.id);
            if direct {
                self.write_view_inputs(&view_key, false, command_phase, layers.len() as u32, time_seconds, frame_count,
                    layers, audio0, audio1, audio2, output_gate, post_effects, spec.stage);
            }
            let mut encoder = self.take_outputs_encoder();
            if let Some(target) = self.slice_targets.get(&spec.id) {
                if let Some(mesh) = spec.mirror_mesh.as_ref() {
                    self.draw_mirror_dome(&mut encoder, &target.render_view, spec.width, spec.height,
                        output_gate, OutputStage { dlayer: self.dome_layer_pass, ..spec.stage },
                        time_seconds.unwrap_or(0.0), &mesh.id);
                } else if direct {
                    self.draw_composite_view(&mut encoder, &view_key, &target.render_view, "Full-detail slice");
                } else {
                self.output_presenter.draw(&self.queue, &mut encoder, &target.render_view,
                    self.creative_frame_index, spec.width, spec.height,
                    output_gate, OutputStage { dlayer: self.dome_layer_pass, ..spec.stage }, time_seconds.unwrap_or(0.0));
                }
                #[cfg(any(target_os = "macos", target_os = "windows"))]
                target.export.blitter.copy(
                    &self.device,
                    &mut encoder,
                    &target.render_view,
                    &target.export.view,
                );
                #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                if let Some(frame) = Self::blit_to_linux_slice_window(
                    &self.device, &self.wgpu_adapter, &mut self.linux_slice_windows, &spec.id, &mut encoder, &target.render_view)
                {
                    self.pending_slice_presents.push(frame);
                }
            }
            self.outputs_encoder = Some(encoder);
            // The mirror pass has one uniform for every mirror Screen: send
            // this one before the next mirror Screen rewrites it.
            if spec.mirror_mesh.is_some() {
                self.submit_outputs();
            }
            if let Some(target) = self.slice_targets.get_mut(&spec.id) {
                target.bump_frame();
            }
        }
    }

    /// Linux: create the child window that presents one Screen, parented to
    /// the Electron Screen window's X11 id, and a Vulkan surface on it.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub(crate) fn attach_linux_slice_window(
        &mut self,
        event_loop: &ActiveEventLoop,
        id: &str,
        x11_window: u64,
        width: u32,
        height: u32,
    ) -> Result<Value, String> {
        use winit::dpi::PhysicalPosition;
        use winit::raw_window_handle::XlibWindowHandle;
        if !linux_x11_presentation() {
            return Err("native Screens need X11 or XWayland".to_string());
        }
        if x11_window == 0 {
            return Err("Screen window has no X11 id".to_string());
        }
        // Re-attaching replaces the previous presenter (a reopened Screen).
        self.linux_slice_windows.remove(id);
        let (width, height) = (width.max(1), height.max(1));
        let parent = RawWindowHandle::Xlib(XlibWindowHandle::new(x11_window as std::ffi::c_ulong));
        let attrs = WindowAttributes::default()
            .with_title("Ghost Arcade Screen")
            .with_decorations(false)
            .with_resizable(false)
            .with_inner_size(PhysicalSize::new(width, height))
            .with_position(PhysicalPosition::new(0, 0))
            .with_visible(true);
        // SAFETY: Electron owns the parent window for as long as the Screen is
        // open and detaches this presenter before it closes the window.
        let attrs = unsafe { attrs.with_parent_window(Some(parent)) };
        let window = Arc::new(
            event_loop
                .create_window(attrs)
                .map_err(|err| format!("could not create the Screen child window: {err}"))?,
        );
        // The child only shows the picture. With an empty input shape, clicks
        // and keys over it reach the Screen window underneath, so Esc and
        // double-click there keep working once the core is presenting.
        let _ = window.set_cursor_hittest(false);
        let surface = self
            .wgpu_instance
            .create_surface(Arc::clone(&window))
            .map_err(|err| format!("could not create the Screen surface: {err}"))?;
        let caps = surface.get_capabilities(&self.wgpu_adapter);
        if caps.formats.is_empty() {
            return Err("the Screen surface reports no formats".to_string());
        }
        // Same boundary contract as the output window: non-sRGB BGRA8.
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|format| *format == wgpu::TextureFormat::Bgra8Unorm)
            .or_else(|| caps.formats.iter().copied().find(|format| !format.is_srgb()))
            .unwrap_or(caps.formats[0]);
        let present_mode = linux_slice_present_mode(&caps.present_modes);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: wgpu::SurfaceColorSpace::Srgb,
            width,
            height,
            present_mode,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&self.device, &config);
        let blitter = TextureBlitterBuilder::new(&self.device, format)
            .sample_type(wgpu::FilterMode::Linear)
            .build();
        self.linux_slice_windows.insert(id.to_string(), LinuxSliceWindow { window, surface, config, blitter });
        Ok(json!({ "attached": true, "slice_id": id, "width": width, "height": height, "format": format!("{format:?}"), "present_mode": present_mode_label(present_mode) }))
    }

    /// Linux: follow the Electron Screen window when it resizes or goes
    /// fullscreen.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub(crate) fn resize_linux_slice_window(&mut self, id: &str, width: u32, height: u32) -> Result<Value, String> {
        let window = self
            .linux_slice_windows
            .get_mut(id)
            .ok_or_else(|| format!("Screen {id} has no presenter"))?;
        let (width, height) = (width.max(1), height.max(1));
        if (window.config.width, window.config.height) != (width, height) {
            window.config.width = width;
            window.config.height = height;
            window.surface.configure(&self.device, &window.config);
            let _ = window.window.request_inner_size(PhysicalSize::new(width, height));
        }
        Ok(json!({ "resized": true, "slice_id": id, "width": width, "height": height }))
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub(crate) fn detach_linux_slice_window(&mut self, id: &str) -> Value {
        json!({ "detached": self.linux_slice_windows.remove(id).is_some(), "slice_id": id })
    }

    /// Linux: draw a Screen's composite into its child window, if Electron has
    /// attached one. Returns the frame to present after the encoder submits.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub(crate) fn blit_to_linux_slice_window(
        device: &wgpu::Device,
        adapter: &wgpu::Adapter,
        windows: &mut HashMap<String, LinuxSliceWindow>,
        id: &str,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::TextureView,
    ) -> Option<wgpu::SurfaceTexture> {
        let window = windows.get_mut(id)?;
        let usable = match window.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame) => {
                let view = frame.texture.create_view(&wgpu::TextureViewDescriptor::default());
                window.blitter.copy(device, encoder, source, &view);
                return Some(frame);
            }
            wgpu::CurrentSurfaceTexture::Suboptimal(frame) => {
                // A resize can leave an acquired drawable suboptimal. It still
                // owns the swapchain: release it before configuring a new one.
                drop(frame);
                Self::reconfigure_linux_slice_surface(device, adapter, window)
            }
            // Outdated or lost after a resize or a display change: put the
            // surface back and draw this Screen on the next frame. A timeout
            // or an occluded window just skips one.
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                Self::reconfigure_linux_slice_surface(device, adapter, window)
            }
            _ => true,
        };
        if !usable {
            eprintln!("[ghost-core] Screen {id}: its window is gone; presenter released");
            windows.remove(id);
        }
        None
    }

    /// Configure a Screen's surface again, unless its window no longer exists.
    /// Electron can close the Screen window before the detach request reaches
    /// a busy core; configuring a surface whose X11 window is gone is a wgpu
    /// validation error, which would take the whole core down.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub(crate) fn reconfigure_linux_slice_surface(device: &wgpu::Device, adapter: &wgpu::Adapter, window: &LinuxSliceWindow) -> bool {
        if window.surface.get_capabilities(adapter).formats.is_empty() {
            return false;
        }
        window.surface.configure(device, &window.config);
        true
    }

    pub(crate) fn ensure_projector_view_renderer(&mut self) -> &mut projector_view::ProjectorViewRenderer {
        if self.projector_view.as_ref().is_none_or(|renderer| renderer.format() != self.config.format) {
            self.projector_view = Some(projector_view::ProjectorViewRenderer::new(&self.device, &self.queue, self.config.format));
        }
        self.projector_view.as_mut().expect("projector view renderer created above")
    }

    /// One slice fed by a Map Sim projector view: render the projector's
    /// image, then run it through the Screen's output stage (rotation,
    /// grade, blend, masks) into the slice's shared texture.
    pub(crate) fn render_projector_view_slice(
        &mut self,
        spec: &SliceOutputSpec,
        projector_id: &str,
        inputs: &ProjectorViewInputs<'_>,
        output_gate: f32,
        time_seconds: Option<f32>,
    ) {
        let format = self.config.format;
        let stale = self.slice_targets.get(&spec.id).is_some_and(|target| {
            target
                .projector_view_source
                .as_ref()
                .is_none_or(|(texture, ..)| texture.width() != spec.width || texture.height() != spec.height)
        });
        if stale {
            let texture = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("Map Sim projector view slice source"),
                size: wgpu::Extent3d { width: spec.width, height: spec.height, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
            let bind_group = self.output_presenter.input_bind_group(&self.device, &view);
            if let Some(target) = self.slice_targets.get_mut(&spec.id) {
                target.projector_view_source = Some((texture, view, bind_group));
            }
        }
        self.ensure_projector_view_renderer();
        let content_view = gpu_object_cache::view(&self.composite_frame_textures[self.creative_frame_index], &Default::default());
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let mut presented: Option<wgpu::SurfaceTexture> = None;
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Map Sim projector view slice encoder"),
        });
        {
            let Some(target) = self.slice_targets.get(&spec.id) else {
                return;
            };
            let Some((_, source_view, source_input)) = target.projector_view_source.as_ref() else {
                return;
            };
            let renderer = self.projector_view.as_mut().expect("projector view renderer ensured");
            renderer.sync_meshes(&self.device, inputs.meshes);
            let empty = projector_view::ProjectorViewScene::default();
            renderer.render(
                &self.device,
                &self.queue,
                &mut encoder,
                source_view,
                &projector_view::ProjectorViewRequest {
                    scene: inputs.scene.unwrap_or(&empty),
                    projector_id,
                    content: Some(&content_view),
                    overlay: inputs.overlays.get(projector_id),
                    width: spec.width,
                    height: spec.height,
                },
            );
            self.output_presenter.draw_input(
                &self.queue,
                &mut encoder,
                &target.render_view,
                source_input,
                spec.width,
                spec.height,
                output_gate,
                spec.stage,
                time_seconds.unwrap_or(0.0),
            );
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            target.export.blitter.copy(&self.device, &mut encoder, &target.render_view, &target.export.view);
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                presented = Self::blit_to_linux_slice_window(
                    &self.device, &self.wgpu_adapter, &mut self.linux_slice_windows, &spec.id, &mut encoder, &target.render_view);
            }
        }
        // Its own submit: the projector view renderer has one set of
        // uniforms. Nothing in the outputs encoder reads what it draws.
        self.frame_submission = Some(churn_probe::submit(&self.queue, Some(encoder.finish())));
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        if let Some(frame) = presented.take() {
            self.queue.present(frame);
        }
        if let Some(target) = self.slice_targets.get_mut(&spec.id) {
            target.bump_frame();
        }
    }

    /// Read back one Map Sim projector view, rendered from the last
    /// composited master. Diagnostics and the calibration preview use it.
    pub(crate) fn projector_view_snapshot(
        &mut self,
        inputs: &ProjectorViewInputs<'_>,
        projector_id: &str,
        width: u32,
        height: u32,
    ) -> Result<FrameSnapshotReadback, String> {
        let scene = inputs.scene.ok_or_else(|| "Map Sim projector views have not been sent to the core".to_string())?;
        if scene.camera(projector_id).is_none() {
            return Err(format!("Map Sim projector {projector_id} is not in the projector view scene"));
        }
        let format = self.config.format;
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Map Sim projector view snapshot"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let content_view = self.composite_frame_textures[self.creative_frame_index].create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Map Sim projector view snapshot encoder"),
        });
        self.ensure_projector_view_renderer();
        let renderer = self.projector_view.as_mut().expect("projector view renderer ensured");
        renderer.sync_meshes(&self.device, inputs.meshes);
        renderer.render(
            &self.device,
            &self.queue,
            &mut encoder,
            &view,
            &projector_view::ProjectorViewRequest {
                scene,
                projector_id,
                content: Some(&content_view),
                overlay: inputs.overlays.get(projector_id),
                width,
                height,
            },
        );
        churn_probe::submit(&self.queue, Some(encoder.finish()));
        read_texture_to_frame(&self.device, &self.queue, &texture, format, width, height, "Map Sim projector view")
    }

    /// Shared-texture metadata for every live slice display — same shape as
    /// the deck-monitor payload so the electron presenter reuses its import.
    pub(crate) fn slice_output_metadata(&self) -> Value {
        #[cfg(target_os = "macos")]
        {
            if !self.slice_targets.is_empty() {
                let slices: Vec<Value> = self
                    .slice_targets
                    .iter()
                    .map(|(id, target)| {
                        json!({
                            "id": id,
                            "handle": target.export.surface.id().to_string(),
                            "handle_encoding": "integer",
                            "width": target.export.width,
                            "height": target.export.height,
                            "frame": target.export.frame,
                        })
                    })
                    .collect();
                return slice_presentation::metadata("iosurface", slices);
            }
            return slice_presentation::metadata("iosurface", vec![]);
        }
        // Electron's DXGI monitor presenter consumes these named textures.
        // Availability must be true even before the first slice is opened:
        // Electron probes it before choosing the output-window transport.
        #[cfg(target_os = "windows")]
        {
            let slices: Vec<Value> = self
                .slice_targets
                .iter()
                .map(|(id, target)| {
                    json!({
                        "id": id,
                        "shared_name": target.export.shared_name,
                        "width": target.export.width,
                        "height": target.export.height,
                        "frame": target.export.frame,
                    })
                })
                .collect();
            slice_presentation::metadata("dxgi", slices)
        }
        // Linux: the core presents each Screen into an X11 child window of the
        // Electron Screen window. Available only while the event loop is on
        // X11 (see main()); on native Wayland there is nothing to parent into.
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            if let Some(reason) = linux_x11_unavailable_reason() {
                return json!({
                    "available": false,
                    "platform": "wayland",
                    "reason": reason,
                });
            }
            let slices: Vec<Value> = self
                .slice_targets
                .iter()
                .map(|(id, target)| {
                    json!({
                        "id": id,
                        "width": target.width,
                        "height": target.height,
                        "frame": target.frame,
                        "presented": self.linux_slice_windows.contains_key(id),
                    })
                })
                .collect();
            slice_presentation::metadata("x11", slices)
        }
    }
}

impl App {
    /// Slices sample the master-warped composite, and copy the master's
    /// dome and warp out of the output stage when their list is applied.
    /// The editor resends that list only when a screen changes, so carry a
    /// later Master Warp or dome edit into the open slices here; otherwise a
    /// screen window keeps the old master warp while the preview moves.
    pub(crate) fn refresh_slice_master_stage(&mut self) {
        let master = self.output_stage;
        for spec in Arc::make_mut(&mut self.slice_outputs).iter_mut() {
            // Map Sim projector views draw without the master warp or dome.
            if spec.projector_view.is_some() {
                continue;
            }
            let stage = &mut spec.stage;
            stage.dome0 = master.dome0;
            stage.dome1 = master.dome1;
            stage.dome2[0] = master.dome2[0];
            stage.dome3 = master.dome3;
            stage.dome4 = master.dome4;
            stage.mwarp = master.mwarp;
            stage.mwarp_c0 = master.mwarp_c0;
            stage.mwarp_c1 = master.mwarp_c1;
            stage.mwarp_mesh = master.mwarp_mesh;
            stage.mwarp_tangents = master.mwarp_tangents;
        }
    }

    /// Multi-output slice displays. Each entry carries the slice's crop on
    /// the master composition plus its own projector grade, so the core can
    /// composite a full-resolution frame per display rather than having each
    /// slice window re-render the whole scene in WebGL and crop it.
    pub(crate) fn apply_slice_outputs(&mut self, params: &Value) -> Result<Value, String> {
        validate_slice_outputs(params)?;
        let rig = DomeRig::from_params(params.get("domeRig"));
        let mut specs: Vec<SliceOutputSpec> = Vec::new();
        if let Some(entries) = params.get("slices").and_then(Value::as_array) {
            for entry in entries {
                let Some(id) = string_at(entry, &["id"]).filter(|id| !id.trim().is_empty()) else {
                    continue;
                };
                let read = |keys: &[&str], fallback: f64| number_at(entry, keys).unwrap_or(fallback);
                let width = read(&["width"], 1920.0).clamp(16.0, 16384.0) as u32;
                let height = read(&["height"], 1080.0).clamp(16.0, 16384.0) as u32;
                let crop_x = read(&["cropX"], 0.0).clamp(0.0, 0.99) as f32;
                let crop_y = read(&["cropY"], 0.0).clamp(0.0, 0.99) as f32;
                let crop_w = read(&["cropW"], 1.0).clamp(0.01, 1.0 - crop_x as f64) as f32;
                let crop_h = read(&["cropH"], 1.0).clamp(0.01, 1.0 - crop_y as f64) as f32;
                let rotation = (((read(&["rotation"], 0.0) % 360.0) + 360.0) % 360.0 / 90.0).round();
                let blend_gamma = read(&["edgeBlendGamma"], 2.2);
                // Screen warp: 'corners' and 'mesh' control points are sample
                // positions on the master, so they replace the rect crop
                // rather than composing with it — same as blendRenderer.
                let warp_mode = string_at(entry, &["warpMode"])
                    .unwrap_or_else(|| "rect".to_string());
                let (slice_c0, slice_c1) = warp_corners_at(entry.get("corners"));
                let slice_mesh = if warp_mode == "mesh" {
                    warp_mesh_at(entry.get("meshGrid"))
                } else {
                    WarpMesh::none()
                };
                let warp_code = match warp_mode.as_str() {
                    "corners" => 1.0,
                    // A mesh that failed validation falls back to the rect
                    // crop instead of collapsing the screen to a point.
                    "mesh" if slice_mesh.rows >= 2.0 && slice_mesh.cols >= 2.0 => 2.0,
                    _ => 0.0,
                };
                let slice_bezier = if warp_code == 2.0 && slice_mesh.bezier { 1.0 } else { 0.0 };
                // Masks are evaluated in the screen's own UV after the crop
                // and warp have been resolved, so they stay put on the
                // projector when the screen is re-pinned.
                let (mask_header, mask_info, mask_bounds, mask_points) = screen_masks_at(entry.get("masks"));
                // A slice inherits the master dome so a domed rig can still be
                // split across projectors, but overrides every flat transform.
                let stage = OutputStage {
                    out0: [crop_x, crop_y, crop_w, crop_h],
                    out1: [
                        rotation.clamp(0.0, 3.0) as f32,
                        read(&["brightness"], 1.0).max(0.0) as f32,
                        read(&["contrast"], 1.0).max(0.0) as f32,
                        read(&["gamma"], 1.0).max(0.001) as f32,
                    ],
                    edge: [
                        read(&["edgeBlendLeft"], 0.0).clamp(0.0, 0.5) as f32,
                        read(&["edgeBlendRight"], 0.0).clamp(0.0, 0.5) as f32,
                        read(&["edgeBlendTop"], 0.0).clamp(0.0, 0.5) as f32,
                        read(&["edgeBlendBottom"], 0.0).clamp(0.0, 0.5) as f32,
                    ],
                    dome0: self.output_stage.dome0,
                    dome1: self.output_stage.dome1,
                    dome3: self.output_stage.dome3,
                    dome4: self.output_stage.dome4,
                    // The renderer sets this per frame (sync_dome_layers).
                    dlayer: [0.0; 4],
                    dview: [0.0; 4],
                    dview1: [0.0; 4],
                    // Filled from the dome rig below, for a projector Screen.
                    dproj0: [0.0; 4],
                    dproj1: [0.0; 4],
                    dprojs: [[0.0; 4]; 32],
                    // w: Screen alignment aid (7 numbered grid, 8 identify, 9 auto-map stripes);
                    // the main output's test patterns never reach a Screen.
                    dome2: [self.output_stage.dome2[0], blend_gamma as f32, 1.0, match read(&["alignmentAid"], 0.0).round() as i32 { 1 => 7.0, 2 => 8.0, 3 => 9.0, _ => 0.0 }],
                    edge_gamma: [
                        read(&["edgeBlendLeftGamma"], blend_gamma).clamp(0.05, 8.0) as f32,
                        read(&["edgeBlendRightGamma"], blend_gamma).clamp(0.05, 8.0) as f32,
                        read(&["edgeBlendTopGamma"], blend_gamma).clamp(0.05, 8.0) as f32,
                        read(&["edgeBlendBottomGamma"], blend_gamma).clamp(0.05, 8.0) as f32,
                    ],
                    black_level: [
                        read(&["blackLevelR"], 0.0).clamp(0.0, 1.0) as f32,
                        read(&["blackLevelG"], 0.0).clamp(0.0, 1.0) as f32,
                        read(&["blackLevelB"], 0.0).clamp(0.0, 1.0) as f32,
                        read(&["blackLevelFeather"], 0.5).clamp(0.0, 1.0) as f32,
                    ],
                    projector_calibration: std::array::from_fn(|r| std::array::from_fn(|c| entry.get("projectorCalibration").and_then(|v| v.get(r)).and_then(|v| v.get(c)).and_then(Value::as_f64).filter(|v| v.is_finite()).unwrap_or(0.0) as f32)),
                    swarp: [warp_code, slice_mesh.rows, slice_mesh.cols, slice_bezier],
                    swarp_c0: slice_c0,
                    swarp_c1: slice_c1,
                    // Slices sample the master-warped composite, so they
                    // inherit the master warp exactly as the WebGL two-pass
                    // path does (warp the master, then crop from it).
                    mwarp: self.output_stage.mwarp,
                    mwarp_c0: self.output_stage.mwarp_c0,
                    mwarp_c1: self.output_stage.mwarp_c1,
                    swarp_mesh: slice_mesh.points,
                    mwarp_mesh: self.output_stage.mwarp_mesh,
                    swarp_tangents: slice_mesh.tangents,
                    mwarp_tangents: self.output_stage.mwarp_tangents,
                    smask: mask_header,
                    smask_info: mask_info,
                    smask_bounds: mask_bounds,
                    smask_pts: mask_points,
                };
                let projector_view = string_at(entry, &["mapSimProjectorId"])
                    .filter(|projector| !projector.trim().is_empty());
                let mut stage = if projector_view.is_some() { projector_view_output_stage(stage) } else { stage };
                if bool_at(entry, &["domeProjector"]).unwrap_or(false) {
                    if let Some(index) = rig.ids.iter().position(|rig_id| *rig_id == id) {
                        stage.dproj0 = [1.0, index as f32, rig.ids.len() as f32, rig.blend_width];
                        stage.dproj1 = [rig.blend_gamma, 0.0, 0.0, 0.0];
                        stage.dprojs = rig.frusta;
                    }
                }
                let mirror_mesh_id = string_at(entry, &["mirrorMeshId"]).filter(|id| !id.is_empty());
                let mirror_mesh = mirror_mesh_id.as_ref().and_then(|id| self.mirror_meshes.get(id).cloned());
                specs.push(SliceOutputSpec { id, width, height, stage, projector_view, mirror_mesh_id, mirror_mesh });
            }
        }
        let ids: Vec<String> = specs.iter().map(|spec| spec.id.clone()).collect();
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.slice_targets.retain(|id, _| ids.contains(id));
        }
        self.slice_outputs = Arc::new(specs);
        Ok(json!({ "slices": ids }))
    }
}
