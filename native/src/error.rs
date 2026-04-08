use napi::{Error, Result, Status};
use std::fmt::Display;

pub fn invalid_arg(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

pub fn generic_error(message: impl Into<String>) -> Error {
    Error::new(Status::GenericFailure, message.into())
}

pub trait ResultExt<T> {
    fn context(self, context: impl AsRef<str>) -> Result<T>;
}

impl<T, E> ResultExt<T> for std::result::Result<T, E>
where
    E: Display,
{
    fn context(self, context: impl AsRef<str>) -> Result<T> {
        self.map_err(|error| generic_error(format!("{}: {error}", context.as_ref())))
    }
}
