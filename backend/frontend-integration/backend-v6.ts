/** Copy into frontend/src/services/api/backendV6.ts. Existing client converts JSON key case. */
import { apiRequest } from '@/services/api/client';
import type { ApiPlant } from '@/types/api';

export type ReasonCode = 'CURRENT_OK' | 'RELOCATE' | 'NO_FREE_CELL' | 'NO_SUITABLE_CELL';
export interface Evidence {
  basis: 'REFERENCE_SPECIES' | 'REFERENCE_GENUS' | 'REFERENCE_GROUP' | 'ESTIMATED' | 'OPERATOR_DEFINED' | 'UNKNOWN';
  provisional: boolean;
  sourceUrl: string | null;
  sourceEntry: string | null;
  checkedAt: string | null;
  botanicalSourceUrl: string | null;
  sourceNote: string | null;
}
export interface RecommendationResult {
  roomId: number;
  date: string | null;
  period: { startDate: string; endDate: string; dayCount: number } | null;
  plants: Array<{
    plantId: number;
    speciesId: number;
    requiredDli: { min: number; max: number };
    current: { row: number; col: number; totalDli: number; status: 'OK' | 'LOW' | 'HIGH' } | null;
    recommended: { row: number; col: number; totalDli: number; score: number } | null;
  }>;
  warnings: string[];
}
export interface RecommendationPlan {
  planId: string;
  expiresAt: string;
  geometryVersion: number;
  result: RecommendationResult;
  decisions: Array<{ plantId: number; reasonCode: ReasonCode; canApply: boolean; evidence: Evidence }>;
}
export function createRecommendationPlan(roomId: number, dliJobId: string, blockedCells: [number, number][] = []) {
  return apiRequest<RecommendationPlan>(`/rooms/${roomId}/recommendation-plans`, {
    method: 'POST', body: { dliJobId, blockedCells },
  });
}
export function applyRecommendationPlan(roomId: number, planId: string, plantIds?: number[]) {
  return apiRequest<{ planId: string; appliedCount: number; plants: ApiPlant[] }>(
    `/rooms/${roomId}/recommendation-plans/${encodeURIComponent(planId)}/apply`, {
      method: 'POST', body: plantIds ? { plantIds } : {},
    });
}
export function saveBlockedCells(roomId: number, geometryVersion: number, cellSizeM: number, blockedCells: [number, number][]) {
  return apiRequest(`/rooms/${roomId}/blocked-cells`, {
    method: 'PUT', body: { geometryVersion, cellSizeM, blockedCells },
  });
}
export function fetchBlockedCells(roomId: number, cellSizeM = 0.2) {
  return apiRequest<{ roomId: number; geometryVersion: number; cellSizeM: number; stale: boolean; blockedCells: [number, number][] }>(
    `/rooms/${roomId}/blocked-cells`, { query: { cell_size_m: cellSizeM } });
}
export function correctWatering(plantId: number, recordId: number, wateredAt: string) {
  return apiRequest<ApiPlant>(`/plants/${plantId}/waterings/${recordId}`, { method: 'PATCH', body: { wateredAt } });
}
export function undoWatering(plantId: number, recordId: number) {
  return apiRequest<ApiPlant>(`/plants/${plantId}/waterings/${recordId}`, { method: 'DELETE' });
}
export function fetchNotificationSchedule(startDate: string, endDate: string) {
  return apiRequest<{ delivery: 'DEVICE_LOCAL'; pushConfigured: false; scheduleVersion: string;
    notifications: Array<{ notificationId: string; eventId: string; plantId: number; title: string; scheduledAt: string; taskType: string }> }>(
    '/notifications/schedule', { query: { start_date: startDate, end_date: endDate } });
}
