//! The native shader host: ISF, GLSL and WGSL layer shaders, from source
//! handling and the shader registry to uniforms, passes and the GPU frames.

mod source;
pub(crate) use source::*;
mod registry;
pub(crate) use registry::*;
mod uniforms;
pub(crate) use uniforms::*;
mod passes;
pub(crate) use passes::*;
mod render;
pub(crate) use render::*;
