import type { Page } from './types';

/**
 * Result of a paged `list()` call.
 * `await` it for the first page, or iterate with `for await` to walk every item across pages.
 */
export class PagePromise<T> implements PromiseLike<Page<T>>, AsyncIterable<T> {
  private first: Promise<Page<T>> | undefined;

  /**
   * @internal
   * @param fetchPage Fetches the page at `cursor` (the previous page's `next_cursor`; `undefined` for the first page).
   */
  constructor(private readonly fetchPage: (cursor: string | undefined) => Promise<Page<T>>) {}

  private firstPage(): Promise<Page<T>> {
    this.first ??= this.fetchPage(undefined);
    return this.first;
  }

  // biome-ignore lint/suspicious/noThenProperty: PagePromise is intentionally awaitable
  then<A = Page<T>, B = never>(
    onfulfilled?: ((value: Page<T>) => A | PromiseLike<A>) | null,
    // biome-ignore lint/suspicious/noExplicitAny: same signature as Promise
    onrejected?: ((reason: any) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.firstPage().then(onfulfilled, onrejected);
  }

  // biome-ignore lint/suspicious/noExplicitAny: same signature as Promise
  catch<B = never>(onrejected?: ((reason: any) => B | PromiseLike<B>) | null): Promise<Page<T> | B> {
    return this.firstPage().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<Page<T>> {
    return this.firstPage().finally(onfinally);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page = await this.firstPage();
    for (;;) {
      yield* page.data;
      // 続きの位置が無ければ止める（続きがあると言いながら空のページ・位置の無いページで、同じページを読み続けない）
      if (!page.has_more || !page.next_cursor || page.data.length === 0) return;
      page = await this.fetchPage(page.next_cursor);
    }
  }
}
