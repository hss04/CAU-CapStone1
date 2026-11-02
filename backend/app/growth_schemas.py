"""Metadata for a plant's dated photo timeline; binary data has separate endpoints."""
from datetime import date, datetime, timezone
from typing import Annotated, Literal

from pydantic import AfterValidator, AwareDatetime, Field, computed_field, field_validator, model_validator

from app.schemas import Input, KST, Output


def validate_taken_at(value):
    if value.astimezone(KST).date() > datetime.now(KST).date():
        raise ValueError('taken_at cannot be on a future date (Asia/Seoul)')
    return value.astimezone(timezone.utc)


TakenAt = Annotated[AwareDatetime, AfterValidator(validate_taken_at)]


class GrowthPhotoUpdate(Input):
    taken_at: TakenAt | None = None
    note: str | None = Field(default=None, max_length=2000)

    @model_validator(mode='after')
    def valid_update(self):
        if not self.model_fields_set:
            raise ValueError('Provide taken_at or note')
        if 'taken_at' in self.model_fields_set and self.taken_at is None:
            raise ValueError('taken_at must not be null')
        return self


class GrowthPhotoOut(Output):
    id: int
    plant_id: int
    taken_at: datetime
    taken_on: date
    note: str | None
    width: int
    height: int
    byte_size: int
    created_at: datetime
    content_type: Literal['image/jpeg'] = 'image/jpeg'

    @field_validator('taken_at', 'created_at')
    @classmethod
    def kst_timestamp(cls, value):
        value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
        return value.astimezone(KST)

    @computed_field
    @property
    def image_url(self) -> str:
        return f'/api/v1/growth-photos/{self.id}/image'

    @computed_field
    @property
    def thumbnail_url(self) -> str:
        return f'/api/v1/growth-photos/{self.id}/thumbnail'


class GrowthPhotoList(Output):
    plant_id: int
    plant_nickname: str
    timezone: Literal['Asia/Seoul'] = 'Asia/Seoul'
    total: int
    limit: int
    offset: int
    has_more: bool
    photos: list[GrowthPhotoOut]
