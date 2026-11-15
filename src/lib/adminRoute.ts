import { useParams } from 'react-router-dom';

/**
 * Admin URLs look like /admin/<section>/<sub>, e.g.
 *   /admin/finance/partners   /admin/inventory/purchases   /admin/orders/<order id>
 *   /admin/products/<id>      /admin/products/new          /admin/suppliers/<id>
 * Returns the <sub> part ('' when there is none), so every tab and detail screen has its own link
 * that can be bookmarked, shared, and used with the browser's back button.
 */
export function useAdminSub(): string {
  const { '*': splat = '' } = useParams();
  return splat.split('/').slice(1).filter(Boolean).join('/');
}
