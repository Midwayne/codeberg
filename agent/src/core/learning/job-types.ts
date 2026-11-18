/** Durable background job kinds; each runs through the shared learning queue. */
export type KnowledgeJobType =
  | 'extract_knowledge'
  | 'extract_dataset'
  | 'consolidate_knowledge'
  | 'evaluate_output'
  | 'extract_profile';
