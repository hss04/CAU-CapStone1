from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    database_url: str = 'sqlite:///./data/plantlight.db'
    jwt_secret: str = Field(min_length=32)
    access_token_expire_minutes: int = Field(default=60, ge=1, le=1440)
    cors_origins: list[str] = []

    @field_validator('jwt_secret')
    @classmethod
    def reject_placeholder(cls, value: str) -> str:
        if value.startswith('replace-with-'):
            raise ValueError('Run python scripts/init_env.py to generate JWT_SECRET')
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
