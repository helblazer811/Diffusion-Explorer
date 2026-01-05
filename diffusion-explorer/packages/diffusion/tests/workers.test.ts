import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Import the types exported from workers index
import {
    FlowWorkerMessageType,
    DiffusionWorkerMessageType,
    WorkerResponseType
} from '../src/workers/index';

// Import the model classes that workers depend on
import { FlowModel } from '../src/flow_matching/flow_matching';
import { DiffusionModel } from '../src/diffusion/diffusion';
import { generateUniformGridSamples } from '../src/utils';

describe('Worker Files', () => {
    const workersDir = path.join(__dirname, '../src/workers');

    it('flow_model.worker.ts should exist', () => {
        const workerPath = path.join(workersDir, 'flow_model.worker.ts');
        expect(fs.existsSync(workerPath)).toBe(true);
    });

    it('diffusion_model.worker.ts should exist', () => {
        const workerPath = path.join(workersDir, 'diffusion_model.worker.ts');
        expect(fs.existsSync(workerPath)).toBe(true);
    });

    it('index.ts should exist', () => {
        const indexPath = path.join(workersDir, 'index.ts');
        expect(fs.existsSync(indexPath)).toBe(true);
    });
});

describe('Worker Type Exports', () => {
    it('should export FlowWorkerMessageType', () => {
        const validTypes: FlowWorkerMessageType[] = [
            'sample',
            'sample_from_initial_points',
            'sample_grid',
            'vector_field_grid',
            'train',
            'train_rectified',
            'stop',
            'stop_training'
        ];
        expect(validTypes.length).toBe(8);
    });

    it('should export DiffusionWorkerMessageType', () => {
        const validTypes: DiffusionWorkerMessageType[] = [
            'sample',
            'sample_from_initial_points',
            'sample_grid',
            'train',
            'stop',
            'stop_training'
        ];
        expect(validTypes.length).toBe(6);
    });

    it('should export WorkerResponseType', () => {
        const validTypes: WorkerResponseType[] = [
            'step',
            'epoch_chunk',
            'rectified_step_complete',
            'result',
            'cancelled',
            'error',
            'status'
        ];
        expect(validTypes.length).toBe(7);
    });
});

describe('Worker Dependencies', () => {
    it('FlowModel should be importable (used by flow worker)', () => {
        expect(FlowModel).toBeDefined();
        expect(typeof FlowModel).toBe('function');
    });

    it('DiffusionModel should be importable (used by diffusion worker)', () => {
        expect(DiffusionModel).toBeDefined();
        expect(typeof DiffusionModel).toBe('function');
    });

    it('generateUniformGridSamples should be importable (used by flow worker)', () => {
        expect(generateUniformGridSamples).toBeDefined();
        expect(typeof generateUniformGridSamples).toBe('function');
    });

    it('FlowModel.fromConfig should exist', () => {
        expect(typeof FlowModel.fromConfig).toBe('function');
    });
});

describe('Worker File Content Validation', () => {
    it('flow_model.worker.ts should import FlowModel', () => {
        const workerPath = path.join(__dirname, '../src/workers/flow_model.worker.ts');
        const content = fs.readFileSync(workerPath, 'utf-8');

        expect(content).toContain("import { FlowModel }");
        expect(content).toContain("from '../flow_matching/flow_matching'");
        expect(content).toContain("import { generateUniformGridSamples }");
        expect(content).toContain("self.onmessage");
    });

    it('diffusion_model.worker.ts should import DiffusionModel', () => {
        const workerPath = path.join(__dirname, '../src/workers/diffusion_model.worker.ts');
        const content = fs.readFileSync(workerPath, 'utf-8');

        expect(content).toContain("import { DiffusionModel }");
        expect(content).toContain("from '../diffusion/diffusion'");
        expect(content).toContain("self.onmessage");
    });

    it('flow_model.worker.ts should handle expected message types', () => {
        const workerPath = path.join(__dirname, '../src/workers/flow_model.worker.ts');
        const content = fs.readFileSync(workerPath, 'utf-8');

        // Check for message type handling
        expect(content).toContain("case 'sample':");
        expect(content).toContain("case 'sample_from_initial_points':");
        expect(content).toContain("case 'sample_grid':");
        expect(content).toContain("case 'vector_field_grid':");
        expect(content).toContain("case 'train':");
        expect(content).toContain("case 'train_rectified':");
    });

    it('diffusion_model.worker.ts should handle expected message types', () => {
        const workerPath = path.join(__dirname, '../src/workers/diffusion_model.worker.ts');
        const content = fs.readFileSync(workerPath, 'utf-8');

        // Check for message type handling
        expect(content).toContain("case 'sample':");
        expect(content).toContain("case 'sample_from_initial_points':");
        expect(content).toContain("case 'sample_grid':");
        expect(content).toContain("case 'train':");
    });

    it('both workers should have cancellation support', () => {
        const flowWorkerPath = path.join(__dirname, '../src/workers/flow_model.worker.ts');
        const diffusionWorkerPath = path.join(__dirname, '../src/workers/diffusion_model.worker.ts');

        const flowContent = fs.readFileSync(flowWorkerPath, 'utf-8');
        const diffusionContent = fs.readFileSync(diffusionWorkerPath, 'utf-8');

        // Both should have activeRequests map for cancellation
        expect(flowContent).toContain('activeRequests');
        expect(diffusionContent).toContain('activeRequests');

        // Both should handle stop messages
        expect(flowContent).toContain("type === \"stop\"");
        expect(diffusionContent).toContain("type === \"stop\"");
    });

    it('both workers should have error handling', () => {
        const flowWorkerPath = path.join(__dirname, '../src/workers/flow_model.worker.ts');
        const diffusionWorkerPath = path.join(__dirname, '../src/workers/diffusion_model.worker.ts');

        const flowContent = fs.readFileSync(flowWorkerPath, 'utf-8');
        const diffusionContent = fs.readFileSync(diffusionWorkerPath, 'utf-8');

        // Both should have global error handlers
        expect(flowContent).toContain("addEventListener('unhandledrejection'");
        expect(diffusionContent).toContain("addEventListener('unhandledrejection'");
        expect(flowContent).toContain("addEventListener('error'");
        expect(diffusionContent).toContain("addEventListener('error'");
    });
});
