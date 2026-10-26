/**
 * High-Performance O(1) Fixed-Size Circular Ring Buffer
 * ---------------------------------------------------
 * Pre-allocates memory to eliminate array shifts and garbage collection overhead.
 * Perfect for low-resource VPS (1 vCore, 2GB RAM) running 24/7.
 */
class CircularRingBuffer {
  /**
   * @param {number} capacity Maximum number of data points to retain
   */
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('Capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  /**
   * Pushes a new item in O(1) time
   * @param {*} item
   */
  push(item) {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;

    if (this.size < this.capacity) {
      this.size++;
    } else {
      // Overwriting oldest entry, advance head
      this.head = (this.head + 1) % this.capacity;
    }
  }

  /**
   * Returns all items in chronological order (oldest to newest)
   * @returns {Array}
   */
  toArray() {
    const result = new Array(this.size);
    for (let i = 0; i < this.size; i++) {
      result[i] = this.buffer[(this.head + i) % this.capacity];
    }
    return result;
  }

  /**
   * Returns current count of stored items
   * @returns {number}
   */
  length() {
    return this.size;
  }

  /**
   * Clears the buffer
   */
  clear() {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }
}

module.exports = CircularRingBuffer;
