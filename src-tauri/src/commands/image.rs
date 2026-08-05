use std::fs;

#[tauri::command]
pub fn save_image_file(bytes: Vec<u8>, file_name: String) -> Result<bool, String> {
    let path = rfd::FileDialog::new()
        .set_title("保存生成图片")
        .set_file_name(&file_name)
        .add_filter("PNG image", &["png"])
        .save_file();

    let Some(path) = path else {
        return Ok(false);
    };

    fs::write(path, bytes).map_err(|error| error.to_string())?;
    Ok(true)
}
