use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptCategory {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PromptCategoryInput {
    List(Vec<PromptCategoryRaw>),
    Wrapped { categories: Vec<PromptCategoryRaw> },
    Single(PromptCategoryRaw),
}

#[derive(Debug, Deserialize)]
struct PromptCategoryRaw {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
}

const DEFAULT_SUGGESTIONS_JSON: &str = r#"[
  {
    "id": "quality",
    "name": "Style & Quality",
    "description": "Resolution, finish, and rendering style boosters",
    "tags": [
      "masterpiece",
      "best quality",
      "highres",
      "absurdres",
      "ultra-detailed",
      "extremely detailed",
      "intricate details",
      "official art",
      "anime screencap",
      "anime coloring",
      "cel shading",
      "soft shading",
      "flat color",
      "clean lineart",
      "sketch",
      "lineart",
      "monochrome",
      "greyscale",
      "sepia",
      "pastel colors",
      "vibrant colors",
      "muted colors",
      "high contrast",
      "depth of field",
      "bokeh",
      "sharp focus",
      "8k wallpaper",
      "aesthetic",
      "cinematic",
      "film grain",
      "retro artstyle",
      "1980s style",
      "1990s style"
    ]
  },
  {
    "id": "count",
    "name": "Character Count",
    "description": "How many characters are in frame",
    "tags": [
      "1girl",
      "1boy",
      "2girls",
      "2boys",
      "multiple girls",
      "multiple boys",
      "solo",
      "solo focus",
      "duo",
      "couple",
      "group",
      "crowd"
    ]
  },
  {
    "id": "composition",
    "name": "Composition & Camera",
    "description": "Shot distance, angle, and framing",
    "tags": [
      "portrait",
      "upper body",
      "cowboy shot",
      "full body",
      "close-up",
      "face focus",
      "extreme close-up",
      "wide shot",
      "dutch angle",
      "dynamic angle",
      "fisheye",
      "foreshortening",
      "from above",
      "from below",
      "from side",
      "from behind",
      "over shoulder",
      "profile",
      "silhouette",
      "vanishing point",
      "panning view",
      "tilted frame",
      "head out of frame",
      "centered"
    ]
  },
  {
    "id": "lighting",
    "name": "Lighting & Atmosphere",
    "description": "Light sources, time of day, and ambient mood",
    "tags": [
      "cinematic lighting",
      "volumetric lighting",
      "dramatic lighting",
      "moody lighting",
      "soft lighting",
      "rim lighting",
      "backlit",
      "dappled sunlight",
      "sunbeam",
      "god rays",
      "golden hour",
      "blue hour",
      "sunrise",
      "sunset",
      "twilight",
      "neon glow",
      "neon lights",
      "lens flare",
      "ambient light",
      "studio lighting",
      "candlelight",
      "lantern",
      "moonlight",
      "moonbeam",
      "starlight",
      "glowing",
      "dark theme",
      "dim light",
      "light particles",
      "floating particles",
      "embers",
      "fireflies",
      "smoke",
      "haze",
      "dust motes"
    ]
  },
  {
    "id": "background",
    "name": "Background & Scenery",
    "description": "Where the scene happens",
    "tags": [
      "simple background",
      "white background",
      "black background",
      "gradient background",
      "scenery",
      "city",
      "cityscape",
      "city street",
      "cyberpunk",
      "cyberpunk city",
      "tokyo street",
      "rooftop",
      "alleyway",
      "shrine",
      "torii gate",
      "temple",
      "castle",
      "fantasy landscape",
      "floating islands",
      "ancient ruins",
      "forest",
      "deep forest",
      "bamboo forest",
      "flower field",
      "sunflower field",
      "meadow",
      "mountain",
      "lake",
      "river",
      "waterfall",
      "ocean",
      "beach",
      "tropical beach",
      "underwater",
      "clouds",
      "night sky",
      "starry sky",
      "milky way",
      "full moon",
      "crescent moon",
      "aurora",
      "cherry blossoms",
      "falling petals",
      "classroom",
      "school",
      "library",
      "cafe",
      "cafe interior",
      "restaurant",
      "kitchen",
      "bedroom",
      "living room",
      "bathroom",
      "hot spring",
      "train interior",
      "train station",
      "car interior",
      "convenience store",
      "festival",
      "summer festival",
      "fireworks",
      "amusement park"
    ]
  },
  {
    "id": "weather",
    "name": "Weather & Season",
    "description": "Sky conditions and time of year",
    "tags": [
      "sunny",
      "clear sky",
      "overcast",
      "rain",
      "drizzle",
      "heavy rain",
      "thunderstorm",
      "lightning",
      "snow",
      "snowing",
      "heavy snow",
      "blizzard",
      "wind",
      "gust of wind",
      "fog",
      "mist",
      "heat haze",
      "rainbow",
      "spring",
      "summer",
      "autumn",
      "winter",
      "falling leaves"
    ]
  }
]"#;

const EXAMPLE_CUSTOM_JSON: &str = r#"[
  {
    "id": "clothing",
    "name": "Clothing & Outfits",
    "description": "Example custom category - rename or edit to your preference",
    "tags": [
      "school uniform",
      "sailor suit",
      "kimono",
      "yukata",
      "hoodie",
      "t-shirt",
      "dress",
      "sundress",
      "maid outfit",
      "armor",
      "jacket",
      "sweater",
      "turtleneck",
      "swimsuit",
      "bikini"
    ]
  }
]"#;

fn suggestions_dir(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("prompt_suggestions");

    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn ensure_default_files(dir: &Path) -> Result<(), String> {
    let mut has_json = false;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.path().extension().is_some_and(|ext| ext == "json") {
                has_json = true;
                break;
            }
        }
    }

    if !has_json {
        let default_file = dir.join("default.json");
        fs::write(&default_file, DEFAULT_SUGGESTIONS_JSON).map_err(|e| e.to_string())?;
    }

    let example_file = dir.join("custom_example.json.example");
    if !example_file.exists() {
        let _ = fs::write(&example_file, EXAMPLE_CUSTOM_JSON);
    }

    Ok(())
}

fn slugify(text: &str) -> String {
    let s: String = text
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = s.trim_matches('_');
    if trimmed.is_empty() {
        "category".to_string()
    } else {
        trimmed.to_string()
    }
}

#[tauri::command(async)]
pub fn load_prompt_suggestions(app_handle: AppHandle) -> Result<Vec<PromptCategory>, String> {
    let dir = suggestions_dir(&app_handle)?;
    ensure_default_files(&dir)?;

    let mut entries_paths: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().is_some_and(|ext| ext == "json") {
                entries_paths.push(path);
            }
        }
    }

    // Sort alphabetically so default.json comes first, followed by others
    entries_paths.sort_by(|a, b| {
        let a_is_default = a.file_stem().is_some_and(|s| s == "default");
        let b_is_default = b.file_stem().is_some_and(|s| s == "default");
        match (a_is_default, b_is_default) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.cmp(b),
        }
    });

    let mut categories: Vec<PromptCategory> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for path in entries_paths {
        let filename_stem = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };

        let Ok(input) = serde_json::from_str::<PromptCategoryInput>(&content) else {
            continue;
        };

        let raw_list = match input {
            PromptCategoryInput::List(list) => list,
            PromptCategoryInput::Wrapped { categories } => categories,
            PromptCategoryInput::Single(single) => vec![single],
        };

        for raw in raw_list {
            let clean_tags: Vec<String> = raw
                .tags
                .into_iter()
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect();

            if clean_tags.is_empty() && raw.name.is_none() && raw.id.is_none() {
                continue;
            }

            let name = raw
                .name
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| raw.id.clone().unwrap_or_else(|| filename_stem.clone()));

            let base_id = raw
                .id
                .filter(|i| !i.trim().is_empty())
                .unwrap_or_else(|| slugify(&name));

            let mut final_id = base_id.clone();
            let mut counter = 2;
            while seen_ids.contains(&final_id) {
                final_id = format!("{base_id}_{counter}");
                counter += 1;
            }
            seen_ids.insert(final_id.clone());

            categories.push(PromptCategory {
                id: final_id,
                name,
                description: raw.description.filter(|d| !d.trim().is_empty()),
                tags: clean_tags,
            });
        }
    }

    Ok(categories)
}

#[tauri::command(async)]
pub fn open_prompt_suggestions_folder(app_handle: AppHandle) -> Result<(), String> {
    let dir = suggestions_dir(&app_handle)?;
    crate::show_in_folder(dir.to_string_lossy().to_string())
}
