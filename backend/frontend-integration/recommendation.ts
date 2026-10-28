/** frontend f4c9c50: copy to src/types/recommendation.ts.
 * apiRequest camelizes the server's snake_case JSON recursively.
 */
export interface ApiRecommendationResponse {
  roomId: number;
  date: string | null;
  period: Record<string, unknown> | null;
  plants: Array<{
    plantId: number;
    speciesId: number;
    requiredDli: { min: number; max: number };
    current: { row: number; col: number; totalDli: number; status: 'OK' | 'LOW' | 'HIGH' } | null;
    recommended: { row: number; col: number; totalDli: number; score: number } | null;
  }>;
  warnings: string[];
}
