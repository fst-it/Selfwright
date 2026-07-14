import type { Result } from "../shared/result.js";
import type { TruthError } from "../truth/errors.js";
import type {
  Archetype,
  CompFloors,
  DriftEntry,
  DriftIndex,
  EvidenceEntry,
  Gap,
  Identity,
  Ontology,
} from "../truth/schemas/index.js";

export interface TruthPort {
  /** Load and validate identity.yml. */
  loadIdentity(): Promise<Result<Identity, TruthError>>;

  /** Load and validate truth/evidence/registry.yml. */
  loadEvidenceRegistry(): Promise<Result<EvidenceEntry[], TruthError>>;

  /** Load and validate truth/comp-floors.data.yml. */
  loadCompFloors(): Promise<Result<CompFloors, TruthError>>;

  /** Load and validate truth/keyword-ontology.yml. */
  loadOntology(): Promise<Result<Ontology, TruthError>>;

  /**
   * Load all archetype front-matter from the truth/archetypes/ directory.
   * Returns an empty array when no archetype files are present yet.
   */
  loadArchetypes(): Promise<Result<Archetype[], TruthError>>;

  /**
   * Load drift entries from drifts/companies/<slug>.yml.
   * Returns all drift entries across all company files when slug is omitted.
   * Returns an empty array when the drifts directory is empty.
   */
  loadDrifts(slug?: string): Promise<Result<DriftEntry[], TruthError>>;

  /**
   * Load the drift index (drifts/index.yml).
   * Returns undefined when no index exists yet.
   */
  loadDriftIndex(): Promise<Result<DriftIndex | undefined, TruthError>>;

  /**
   * Load and validate the structured gap ledger (truth/gaps.yml).
   * Returns an empty array when the file doesn't exist yet.
   */
  loadGaps(): Promise<Result<Gap[], TruthError>>;

  /**
   * Assert that gaps-and-risks.md exists and is non-empty.
   * Full structured gap parsing is deferred to Phase 1.3.
   */
  assertGapsFileExists(): Promise<Result<true, TruthError>>;
}
