use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const USER_DATA_DIR: &str = ".chatdesk";

fn validate_file_name(file_name: &str) -> Result<&str, String> {
    match file_name {
        "settings.json" | "bookmarks.json" | "system-logs.json" => Ok(file_name),
        _ => Err(format!("不允许访问用户数据文件：{file_name}")),
    }
}

pub fn user_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .home_dir()
        .map_err(|error| format!("无法定位用户主目录：{error}"))?
        .join(USER_DATA_DIR);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }

    Ok(directory)
}

pub fn user_file_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let file_name = validate_file_name(file_name)?;
    Ok(user_data_dir(app)?.join(file_name))
}

pub fn read_user_file(app: &AppHandle, file_name: &str) -> Result<Option<String>, String> {
    let path = user_file_path(app, file_name)?;
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn write_user_file(app: &AppHandle, file_name: &str, contents: &str) -> Result<(), String> {
    let path = user_file_path(app, file_name)?;
    let temporary = path.with_extension(format!("json.{}.tmp", std::process::id()));
    fs::write(&temporary, contents).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn read_user_store(app: AppHandle, file_name: String) -> Result<String, String> {
    Ok(read_user_file(&app, &file_name)?.unwrap_or_default())
}

#[tauri::command]
pub fn write_user_store(app: AppHandle, file_name: String, contents: String) -> Result<(), String> {
    write_user_file(&app, &file_name, &contents)
}
