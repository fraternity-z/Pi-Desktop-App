use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimePaths {
    pub node_path: PathBuf,
    pub sdk_root: PathBuf,
}
