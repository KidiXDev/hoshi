import folder_paths


def get_filenames(category: str) -> list:
    try:
        return folder_paths.get_filename_list(category)
    except Exception:
        return []


def get_all_unets() -> list:
    unets = set()
    for cat in ["unet", "diffusion_models"]:
        for name in get_filenames(cat):
            unets.add(name)
    return sorted(list(unets))


def get_all_clips() -> list:
    clips = set()
    for cat in ["clip", "text_encoders"]:
        for name in get_filenames(cat):
            clips.add(name)
    return sorted(list(clips))


def get_samplers_list() -> list:
    try:
        import comfy.samplers

        return list(comfy.samplers.KSampler.SAMPLERS)
    except Exception:
        return []


def get_schedulers_list() -> list:
    try:
        import comfy.samplers

        return list(comfy.samplers.KSampler.SCHEDULERS)
    except Exception:
        return []
