"""Validate still images and prepare bounded JPEGs for plant growth records."""
from io import BytesIO
import warnings

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError


MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
IMAGE_MAX_SIDE = 2048
THUMBNAIL_MAX_SIDE = 320
ALLOWED_FORMATS = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'WEBP': 'image/webp'}


def prepare_image(raw, declared_type):
    if not raw:
        raise HTTPException(422, 'Photo must not be empty')
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, 'Photo exceeds the 10 MiB upload limit')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as probe:
                if probe.format not in ALLOWED_FORMATS:
                    raise HTTPException(415, 'Use a JPEG, PNG or WebP still photo')
                expected_type = ALLOWED_FORMATS[probe.format]
                if declared_type not in (None, '', 'application/octet-stream', expected_type):
                    raise HTTPException(415, 'Content-Type does not match the photo format')
                if probe.width * probe.height > MAX_IMAGE_PIXELS:
                    raise HTTPException(413, 'Photo exceeds the 25 megapixel limit')
                if getattr(probe, 'is_animated', False):
                    raise HTTPException(415, 'Use a still photo instead of an animation')
                probe.verify()
            # Decode after verification, apply camera orientation, and bound storage.
            with Image.open(BytesIO(raw)) as source:
                source.load()
                image = ImageOps.exif_transpose(source)
                image.thumbnail((IMAGE_MAX_SIDE, IMAGE_MAX_SIDE), Image.Resampling.LANCZOS)
                if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
                    rgba = image.convert('RGBA')
                    image = Image.new('RGB', rgba.size, 'white')
                    image.paste(rgba, mask=rgba.getchannel('A'))
                else:
                    image = image.convert('RGB')
                # Do not retain EXIF/GPS or other metadata in served images.
                image.info.clear()
                full = BytesIO()
                image.save(full, 'JPEG', quality=88, optimize=True)
                width, height = image.size
                image.thumbnail((THUMBNAIL_MAX_SIDE, THUMBNAIL_MAX_SIDE), Image.Resampling.LANCZOS)
                thumbnail = BytesIO()
                image.save(thumbnail, 'JPEG', quality=80, optimize=True)
                return full.getvalue(), thumbnail.getvalue(), width, height
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise HTTPException(413, 'Photo dimensions are too large') from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise HTTPException(422, 'Photo is not a valid, complete image') from exc
