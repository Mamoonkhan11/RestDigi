/**
 * @jest-environment node
 */
import { middleware } from '@/middleware';
import { NextRequest } from 'next/server';

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${pathname}`));
}

<<<<<<< HEAD
describe('middleware — real Supabase & Next.js request testing', () => {
=======
describe('middleware — Supabase & Next.js request testing', () => {
>>>>>>> automation
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 1. Route Filtering (No database interaction)
  // ════════════════════════════════════════════════════════════════════════════
  describe('route filtering — non-menu routes bypass database checks', () => {
    it('passes through /admin without hitting Supabase', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;

      const res = await middleware(makeRequest('/admin'));
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('passes through /login without hitting Supabase', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;

      const res = await middleware(makeRequest('/login'));
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('passes through root / without hitting Supabase', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;

      const res = await middleware(makeRequest('/'));
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('passes through bare /menu (no slug) without hitting Supabase', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;

      const res = await middleware(makeRequest('/menu'));
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('passes through nested /menu/:slug/dish without intercepting', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;

      const res = await middleware(makeRequest('/menu/pizza-palace/dish/123'));
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Reserved Slugs (Immediate pass-through)
  // ════════════════════════════════════════════════════════════════════════════
  describe('reserved slugs — instant pass-through for demo & platform routes', () => {
    it('allows /menu/restdigi without querying Supabase', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;

      const res = await middleware(makeRequest('/menu/restdigi'));
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('allows /menu/demo-restaurant without querying Supabase', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;

      const res = await middleware(makeRequest('/menu/demo-restaurant'));
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('allows /menu/the-backyard-grill (landing page demo menu) without querying Supabase', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;

      const res = await middleware(makeRequest('/menu/the-backyard-grill'));
      expect(res.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. Active Subscription Flow (Real Supabase query & pass-through)
  // ════════════════════════════════════════════════════════════════════════════
  describe('active subscriptions — passes through to menu UI', () => {
    it('queries Supabase with proper PostgREST parameters and returns 200 pass-through', async () => {
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      let requestedUrl = '';

      global.fetch = (async (url: string | URL | Request) => {
        requestedUrl = url.toString();
        return new Response(
          JSON.stringify({
            id: 'rest-active-uuid',
            expiry_date: futureDate,
            subscription_status: 'active',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }) as any;

      const res = await middleware(makeRequest('/menu/golden-spoon'));
      expect(res.status).toBe(200);

      // Verify real Supabase PostgREST query structure
      expect(requestedUrl).toContain('/rest/v1/restaurants');
      expect(requestedUrl).toContain('slug=eq.golden-spoon');
      expect(requestedUrl).toContain('select=id%2Cexpiry_date%2Csubscription_status');

      // Verify no HTML maintenance body is returned
      const body = await res.text();
      expect(body).not.toMatch(/<html/i);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 4. Expired Subscription Flow (Blocks UI & Displays Maintenance Card)
  // ════════════════════════════════════════════════════════════════════════════
  describe('expired subscriptions — blocks access and renders maintenance page', () => {
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    it('returns styled HTML maintenance page for expired inactive restaurant', async () => {
      global.fetch = (async () => {
        return new Response(
          JSON.stringify({
            id: 'rest-expired-1',
            expiry_date: pastDate,
            subscription_status: 'inactive',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }) as any;

      const res = await middleware(makeRequest('/menu/expired-bistro'));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');

      const html = await res.text();
      expect(html).toContain('RestDigi Digital Menu Maintenance');
      expect(html).toContain('Please inform your waiter to take your order manually.');
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('automatically transitions active-but-expired restaurant to inactive in DB', async () => {
      let patchCalled = false;
      let patchBody = '';

      global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (init?.method === 'PATCH') {
          patchCalled = true;
          patchBody = String(init.body);
          return new Response(null, { status: 204 });
        }

        // Initial GET query returns expired date with active status
        return new Response(
          JSON.stringify({
            id: 'rest-expiring-2',
            expiry_date: pastDate,
            subscription_status: 'active',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }) as any;

      const res = await middleware(makeRequest('/menu/expired-auto-update'));
      expect(patchCalled).toBe(true);
      expect(patchBody).toContain('"subscription_status":"inactive"');
      expect(res.headers.get('content-type')).toContain('text/html');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 5. Non-Existent Restaurant (PostgREST PGRST116 0 rows)
  // ════════════════════════════════════════════════════════════════════════════
  describe('non-existent restaurant slug', () => {
    it('gracefully passes through when Supabase returns 0 rows (PGRST116)', async () => {
      global.fetch = (async () => {
        return new Response(
          JSON.stringify({
            code: 'PGRST116',
            details: 'The result contains 0 rows',
            message: 'JSON object requested, multiple (or no) rows returned',
          }),
          { status: 406, headers: { 'content-type': 'application/json' } }
        );
      }) as any;

      const res = await middleware(makeRequest('/menu/non-existent-cafe-999'));
      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).not.toContain('text/html');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 6. Fail-Open Database Resilience
  // ════════════════════════════════════════════════════════════════════════════
  describe('database resilience — fail-open strategy', () => {
    it('passes through when Supabase returns a database error', async () => {
      global.fetch = (async () => {
        return new Response(
          JSON.stringify({ code: '42P01', message: 'relation "restaurants" does not exist' }),
          { status: 500, headers: { 'content-type': 'application/json' } }
        );
      }) as any;

      const res = await middleware(makeRequest('/menu/golden-spoon'));
      expect(res.status).toBe(200);
    });

    it('passes through when Supabase returns an HTTP 500 internal server error', async () => {
      global.fetch = (async () => {
        return new Response('Internal Server Error', { status: 500 });
      }) as any;

      const res = await middleware(makeRequest('/menu/golden-spoon'));
      expect(res.status).toBe(200);
    });
  });
});
