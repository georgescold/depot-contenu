import type { PostgrestError } from "@supabase/supabase-js";

/** Erreur « métier » renvoyée telle quelle au client : { error, ...details }. */
export class ApiError extends Error {
  status: number;
  details?: Record<string, unknown>;
  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Convertit une erreur PostgREST en ApiError lisible. */
export function dbFail(error: PostgrestError, what: string): ApiError {
  switch (error.code) {
    case "23505":
      return new ApiError(409, `Conflit (${what}) : cet élément existe déjà.`, { db: error.message });
    case "23503":
      return new ApiError(409, `Conflit (${what}) : élément lié à d'autres données.`, { db: error.message });
    case "23514":
    case "22P02":
    case "22007":
    case "22008":
    case "22001":
      return new ApiError(400, `Valeur invalide (${what}) : ${error.message}`);
    case "PGRST116":
      return new ApiError(404, `Introuvable (${what}).`);
    default:
      return new ApiError(500, `Erreur base de données (${what}) : ${error.message}`);
  }
}
