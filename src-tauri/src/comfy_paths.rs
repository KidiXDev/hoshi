use std::path::{Path, PathBuf};

pub(crate) fn clean_path(value: &str) -> &str {
    value.trim().trim_matches(['"', '\'']).trim()
}

pub(crate) fn comfy_root(working_dir: &str) -> Result<PathBuf, String> {
    let work = PathBuf::from(clean_path(working_dir));
    if work.as_os_str().is_empty() {
        return Err("Choose your ComfyUI folder in Settings first.".into());
    }
    if work.join("main.py").is_file() {
        Ok(work)
    } else if work.join("ComfyUI").join("main.py").is_file() {
        Ok(work.join("ComfyUI"))
    } else {
        Err(format!(
            "Could not find 'main.py' in '{}' or its ComfyUI subfolder. Select the ComfyUI folder in Settings.",
            work.display()
        ))
    }
}

pub(crate) fn directory_argument(args: &[String], flag: &str, work: &Path) -> Option<PathBuf> {
    let value = args.iter().enumerate().rev().find_map(|(index, arg)| {
        arg.strip_prefix(&format!("{flag}=")).or_else(|| {
            (arg == flag)
                .then(|| args.get(index + 1).map(String::as_str))
                .flatten()
        })
    })?;
    Some(work.join(clean_path(value)))
}

pub(crate) fn base_directory(working_dir: &str, args: &[String]) -> Result<PathBuf, String> {
    let root = comfy_root(working_dir)?;
    let work = PathBuf::from(clean_path(working_dir));
    Ok(directory_argument(args, "--base-directory", &work).unwrap_or(root))
}

pub(crate) fn output_directory(working_dir: &str, args: &[String]) -> Result<PathBuf, String> {
    let work = PathBuf::from(clean_path(working_dir));
    match directory_argument(args, "--output-directory", &work) {
        Some(path) => Ok(path),
        None => Ok(base_directory(working_dir, args)?.join("output")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolves_root_and_output_directories() {
        assert!(comfy_root("").is_err());
        assert!(comfy_root(" \"\" ").is_err());
        let portable = std::env::temp_dir().join(format!("comfy-paths-{}", std::process::id()));
        let comfy = portable.join("ComfyUI");
        fs::create_dir_all(&comfy).unwrap();
        let portable_text = portable.to_str().unwrap();
        assert!(comfy_root(portable_text).is_err());
        fs::write(comfy.join("main.py"), b"").unwrap();
        assert_eq!(comfy_root(&format!("\"{portable_text}\"")).unwrap(), comfy);
        assert_eq!(comfy_root(comfy.to_str().unwrap()).unwrap(), comfy);
        assert_eq!(
            output_directory(portable_text, &[]).unwrap(),
            comfy.join("output")
        );
        assert_eq!(
            output_directory(
                portable_text,
                &["--output-directory".into(), "custom".into()]
            )
            .unwrap(),
            portable.join("custom")
        );
        assert_eq!(
            output_directory(portable_text, &["--base-directory=data".into()]).unwrap(),
            portable.join("data").join("output")
        );
        fs::remove_dir_all(portable).unwrap();
    }
}
