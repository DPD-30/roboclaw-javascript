/**
 * Priority levels for RoboClaw commands.
 */
export const Priority = {
    CRITICAL: 0, // e.g., E-Stop, immediate stop
    NORMAL: 1,   // e.g., Set speed, duty cycle
    LOW: 2,      // e.g., Telemetry, status checks
};

/**
 * A prioritized command queue for RoboClaw communication.
 * Ensures that critical commands are processed first and provides
 * a mechanism to flush the queue for emergency operations.
 */
export class PriorityQueue {
    constructor() {
        this.queues = {
            [Priority.CRITICAL]: [],
            [Priority.NORMAL]: [],
            [Priority.LOW]: [],
        };
        this.processing = false;
        this.currentPromise = null;
        this.currentResolver = null;
    }

    /**
     * Enqueues a command.
     *
     * @param {Function} task - An async function that performs the actual serial communication.
     * @param {number} priority - The priority level from the Priority enum.
     * @returns {Promise} A promise that resolves when the task is completed.
     */
    enqueue(task, priority = Priority.NORMAL) {
        return new Promise((resolve, reject) => {
            this.queues[priority].push({ task, resolve, reject });
            this.processNext();
        });
    }

    /**
     * Processes the next task in the queue based on priority.
     */
    async processNext() {
        if (this.processing) return;

        // Find the highest priority queue that has items
        const priority = Object.keys(this.queues)
            .map(Number)
            .sort((a, b) => a - b)
            .find(p => this.queues[p].length > 0);

        if (priority === undefined) {
            this.processing = false;
            return;
        }

        this.processing = true;
        const { task, resolve, reject } = this.queues[priority].shift();

        try {
            const result = await task();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.processing = false;
            this.processNext();
        }
    }

    /**
     * Flushes all non-critical tasks from the queue.
     * Used during E-Stop or critical state transitions.
     */
    flush() {
        const normal = [...this.queues[Priority.NORMAL]];
        const low = [...this.queues[Priority.LOW]];

        this.queues[Priority.NORMAL] = [];
        this.queues[Priority.LOW] = [];

        // Reject all flushed tasks
        [...normal, ...low].forEach(item => {
            item.reject(new Error("Queue flushed due to critical command"));
        });
    }
}
