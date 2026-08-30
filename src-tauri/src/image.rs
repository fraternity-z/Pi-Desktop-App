use std::path::Path;

pub(crate) const MAX_PROMPT_IMAGES: usize = 12;
pub(crate) const MAX_PROMPT_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
pub(crate) const PROMPT_IMAGE_CACHE_DIR: &str = "composer-attachments";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ImageFormat {
    pub mime_type: &'static str,
    pub extension: &'static str,
}

const GIF: ImageFormat = ImageFormat {
    mime_type: "image/gif",
    extension: "gif",
};
const JPEG: ImageFormat = ImageFormat {
    mime_type: "image/jpeg",
    extension: "jpg",
};
const PNG: ImageFormat = ImageFormat {
    mime_type: "image/png",
    extension: "png",
};
const WEBP: ImageFormat = ImageFormat {
    mime_type: "image/webp",
    extension: "webp",
};

pub(crate) fn image_format_for_mime(mime_type: &str) -> Option<ImageFormat> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/gif" => Some(GIF),
        "image/jpeg" => Some(JPEG),
        "image/png" => Some(PNG),
        "image/webp" => Some(WEBP),
        _ => None,
    }
}

pub(crate) fn image_format_for_path(path: &Path) -> Option<ImageFormat> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "gif" => Some(GIF),
        "jpg" | "jpeg" => Some(JPEG),
        "png" => Some(PNG),
        "webp" => Some(WEBP),
        _ => None,
    }
}

pub(crate) fn detect_image_format(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(PNG)
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(JPEG)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(GIF)
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some(WEBP)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_supported_mime_types_and_extensions() {
        assert_eq!(image_format_for_mime("image/png"), Some(PNG));
        assert_eq!(image_format_for_mime(" IMAGE/JPEG "), Some(JPEG));
        assert_eq!(image_format_for_path(Path::new("photo.JPEG")), Some(JPEG));
        assert_eq!(image_format_for_path(Path::new("photo.svg")), None);
    }

    #[test]
    fn detects_supported_image_signatures() {
        assert_eq!(detect_image_format(b"\x89PNG\r\n\x1a\nrest"), Some(PNG));
        assert_eq!(detect_image_format(&[0xff, 0xd8, 0xff, 0xe0]), Some(JPEG));
        assert_eq!(detect_image_format(b"GIF89arest"), Some(GIF));
        assert_eq!(
            detect_image_format(b"RIFF\x04\x00\x00\x00WEBPrest"),
            Some(WEBP)
        );
        assert_eq!(detect_image_format(b"not an image"), None);
    }
}
