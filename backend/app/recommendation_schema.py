"""Public algorithm 3206220 response, documented without changing its JSON."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class Output(BaseModel):
    model_config = ConfigDict(extra='allow')


class RequiredDli(Output):
    min: float = Field(ge=0, allow_inf_nan=False)
    max: float = Field(ge=0, allow_inf_nan=False)


class CurrentPlacement(Output):
    row: int = Field(ge=0)
    col: int = Field(ge=0)
    total_dli: float = Field(ge=0, allow_inf_nan=False)
    status: Literal['OK', 'LOW', 'HIGH']


class RecommendedPlacement(Output):
    row: int = Field(ge=0)
    col: int = Field(ge=0)
    total_dli: float = Field(ge=0, allow_inf_nan=False)
    score: float = Field(ge=0, le=1, allow_inf_nan=False)


class PlantRecommendation(Output):
    plant_id: int
    species_id: int
    required_dli: RequiredDli
    current: CurrentPlacement | None
    recommended: RecommendedPlacement | None


class RecommendationResponse(Output):
    room_id: int
    date: str | None
    period: dict | None
    plants: list[PlantRecommendation]
    warnings: list[str]
