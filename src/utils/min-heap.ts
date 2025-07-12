// A standard min-heap for top-K selection
export class MinHeap<T> {
  private heap: T[] = [];
  private compare: (a: T, b: T) => number;

  constructor(private k: number, compareFn: (a: T, b: T) => number) {
    this.compare = compareFn;
  }

  size(): number {
    return this.heap.length;
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  insert(item: T) {
    if (this.heap.length < this.k) {
      this.heap.push(item);
      this.bubbleUp(this.heap.length - 1);
    } else if (this.compare(item, this.heap[0]) > 0) {
      this.heap[0] = item;
      this.bubbleDown(0);
    }
  }

  getSorted(compareFn: (a: T, b: T) => number): T[] {
    return this.heap.sort(compareFn);
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.compare(this.heap[index], this.heap[parentIndex]) < 0) {
        [this.heap[index], this.heap[parentIndex]] = [
          this.heap[parentIndex],
          this.heap[index],
        ];
        index = parentIndex;
      } else {
        break;
      }
    }
  }

  private bubbleDown(index: number) {
    while (true) {
      const leftChildIndex = 2 * index + 1;
      const rightChildIndex = 2 * index + 2;
      let smallestChildIndex = index;

      if (
        leftChildIndex < this.heap.length &&
        this.compare(this.heap[leftChildIndex], this.heap[smallestChildIndex]) <
          0
      ) {
        smallestChildIndex = leftChildIndex;
      }

      if (
        rightChildIndex < this.heap.length &&
        this.compare(
          this.heap[rightChildIndex],
          this.heap[smallestChildIndex]
        ) < 0
      ) {
        smallestChildIndex = rightChildIndex;
      }

      if (smallestChildIndex !== index) {
        [this.heap[index], this.heap[smallestChildIndex]] = [
          this.heap[smallestChildIndex],
          this.heap[index],
        ];
        index = smallestChildIndex;
      } else {
        break;
      }
    }
  }
}
