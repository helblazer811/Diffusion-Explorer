import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        testTimeout: 120000,  // Training tests may take time
        hookTimeout: 60000,
        pool: 'forks',  // Use forks instead of threads for better isolation
        poolOptions: {
            forks: {
                singleFork: true,  // Run tests sequentially in single fork
            },
        },
    },
});
