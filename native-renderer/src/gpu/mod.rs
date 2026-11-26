//! GPU plumbing shared by the whole core: device setup, timing, pipelines and
//! readbacks.

mod device;
pub(crate) use device::*;
mod timing;
pub(crate) use timing::*;
mod pipelines;
pub(crate) use pipelines::*;
mod readback;
pub(crate) use readback::*;
