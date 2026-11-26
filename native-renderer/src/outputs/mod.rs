//! Everything that leaves the compositor: the output stage, Screens (slices),
//! deck monitors, the dome, the record target, output export (texture share)
//! and the output windows.

mod stage;
pub(crate) use stage::*;
mod targets;
pub(crate) use targets::*;
mod warp;
pub(crate) use warp::*;
mod dome;
pub(crate) use dome::*;
mod record;
pub(crate) use record::*;
mod export;
pub(crate) use export::*;
mod slices;
mod deck_monitors;
pub(crate) use deck_monitors::*;
mod output_windows;
pub(crate) use output_windows::*;
