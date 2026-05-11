import { PipelineService, createPipelineService } from './pipeline';

let instance: PipelineService | null = null;

export function getPipelineService(): PipelineService {
  if (!instance) instance = createPipelineService();
  return instance;
}
