/**
 * Creates random values with the help of WebCrypto API
 */
function createRandomValuesStream(numberOfBytes = 10, valueInterval = 1000, maxValues = null) {
    const cqs = new CountQueuingStrategy({ highWaterMark: 4 });
    const readableStream = new ReadableStream({
        totalEnqueuedItemsCount: 0,
        interval: null,

        start(controller) {
            logStatusText('`start` method of the readable stream called')
            this.startValueInterval(controller);
        },

        /**
         * Starting the random values generation again after a certain period
         * @param {*} controller 
         */
        async pull(controller) {
            if (controller.desiredSize > 2 && !this.interval) {
                this.startValueInterval(controller);
            }
        },

        async close(controller) {
            logStatusText('`close` method of the readable stream called');
            this.clearValueInterval();
            controller.close();
            return;
        },

        async cancel() {
            logStatusText('`cancel` method of the readable stream called')
            this.clearValueInterval();
        },

        throwFinalError(error) {
            console.log('Errored out');
            console.error(error);

            this.clearValueInterval();
        },

        startValueInterval(controller) {
            if (this.interval) {
                return;
            }

            this.interval = setInterval(() => {
                try {
                    controller.enqueue(randomValuesUint8Array(20));
                    this.totalEnqueuedItemsCount++;
                    this.checkBackpressureSignal(controller);
                    
                    // Close the stream and clear the interval
                    if (maxValues && this.totalEnqueuedItemsCount >= maxValues) {
                        return this.close(controller);  
                    }
                } catch (error) {
                    this.throwFinalError(error);
                }
            }, valueInterval);
        },
        
        /**
         * Clears the value interval stored in this.interval reference
         */
        clearValueInterval() {
            if (this.interval) {
                clearInterval(this.interval);
                this.interval = null;
            }
        },

        /**
         * Checks a backpressure signal  and clears the interval
         * not enqueuing any more values
         * 
         * @param {*} controller 
         * @param {*} interval
         */
        checkBackpressureSignal(controller, interval) {
            if (controller.desiredSize <= 0) {
                this.clearValueInterval();
            }
        }
    }, cqs);

    return readableStream;
}

/**
 * Creates a random values Uint8Array
 * @param {*} numberOfBytes 
 */
function randomValuesUint8Array(numberOfBytes) {
    const uint8Array = new Uint8Array(numberOfBytes);
    return window.crypto.getRandomValues(uint8Array);
}

/**
 * Create a writable stream to display the output with a builtin backpressure
 */
function createOutputWritableStream(parentElement) {
    /**
     * Equivalent to
     * 
     * const cqs = new CountQueuingStrategy({
     *  highWaterMark: 3,
     * });
     */
    const queuingStrategy = {
        highWaterMark: 3,
        size() { return 1; }
    }

    const writable = new WritableStream({
        async write(chunk, controller) {
            try {
                await writeChunk(chunk);
                return;
            } catch (error) {
                return this.finalErrorHandler(error, controller);
            }
        },

        finalErrorHandler(error, controller) {
            controller.error(error);
            logStatusText('Error occured in the writable stream');
            return error;
        },

        close() {
            logStatusText('Closing the stream');
            console.log('Stream closed');
        }
    });

    /**
     * Writes a chunk to the span and appends it to the parent element
     * @param {*} chunk 
     */
    async function writeChunk(chunk) {
        const containerElement = document.createElement('div');
        containerElement.className = 'output-chunk';
        containerElement.textContent = chunk;
        parentElement.appendChild(containerElement);
        return containerElement;
    }

    return writable;
}

function createArrayToStringTransform() {
    const transformStream = new TransformStream({
        transform (chunk, controller) {
            controller.enqueue(`${chunk.constructor.name}(${chunk.join(', ')})`);
        }
    });

    return transformStream;
}

/**
 * Logs text regarding a status which is apart from the
 * data written to the underlying sink and is related to status 
 * of the readable and writable streams
 */

const statusContainer = document.querySelector('.output .status-container');

/**
 * Logs status text
 * @param {*} statusText 
 */
function logStatusText(statusText) {
    const divElement = document.createElement('div');
    divElement.className = 'status-chunk';
    divElement.textContent = statusText;

    statusContainer.appendChild(divElement);
}

/**
 * Demo related code
 */
async function pipeThroughHandler() {
    const outputContainer = document.querySelector('.output .output-container');
    const pipeThroughButton = document.querySelector('.pipe-controls #pipe-through');
    outputContainer.innerHTML = statusContainer.innerHTML = '';

    try {
        pipeThroughButton.disabled = true;
        logStatusText('Started writing to the stream');
        await pipeStream(outputContainer);
    } catch (error) {
        console.error(error);
    }
    
    logStatusText('Done writing to the stream');
    pipeThroughButton.disabled = false;
}

async function pipeStream(parentElement) {
    const readableStream = createRandomValuesStream(10, 1000, 10);
    const writableStream = createOutputWritableStream(parentElement);
    const transformStream = createArrayToStringTransform();

    return readableStream.pipeThrough(transformStream).pipeTo(writableStream);
}

function initDemo() {
    const pipeThroughButton = document.querySelector('.pipe-controls #pipe-through');
    pipeThroughButton.addEventListener('click', pipeThroughHandler);
}

initDemo();