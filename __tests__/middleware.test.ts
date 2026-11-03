/**
 * @jest-environment node
 */
// Mock @supabase/supabase-js
jest.mock('@supabase/supabase-js', () => {
  const single = jest.fn();
  const eq = jest.fn(() => ({ single }));
  const select = jest.fn(() => ({ eq }));
  const updateEq = jest.fn().mockResolvedValue({ error: null });
  const update = jest.fn(() => ({ eq: updateEq }));
  const from = jest.fn(() => ({ select, update }));

  return {
    createClient: jest.fn(() => ({ from })),
    // Expose inner mocks so tests can reconfigure them
    __mocks: { single, eq, select, update, from },
  };
});

// ─── Import middleware AFTER the mock is registered ───────────────────────────
import { middleware } from '@/middleware';
import { NextRequest } from 'next/server';

// Grab the inner mock functions exposed by the factory
const { __mocks } = jest.requireMock('@supabase/supabase-js') as {
  __mocks: {
    single: jest.Mock;
    eq: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
    from: jest.Mock;
  };
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${pathname}`));
}

/** Configures the Supabase mock to return a specific restaurant row */
function setRestaurantResult(data: object | null, error: object | null = null) {
  __mocks.single.mockResolvedValue({ data, error });
}

// ══════════════════════════════════════════════════════════════════════════════
// Route filtering — non-menu routes bypass all DB checks
// ══════════════════════════════════════════════════════════════════════════════
describe('middleware — route filtering', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes through /admin without hitting Supabase', async () => {
    const res = await middleware(makeRequest('/admin'));
    expect(res.status).toBe(200);
    expect(__mocks.from).not.toHaveBeenCalled();
  });

  it('passes through /login without hitting Supabase', async () => {
    const res = await middleware(makeRequest('/login'));
    expect(res.status).toBe(200);
    expect(__mocks.from).not.toHaveBeenCalled();
  });

  it('passes through bare /menu path (no slug) without hitting Supabase', async () => {
    const res = await middleware(makeRequest('/menu'));
    expect(res.status).toBe(200);
    expect(__mocks.from).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Reserved slugs — skip DB check entirely
// ══════════════════════════════════════════════════════════════════════════════
describe('middleware — reserved slugs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes through /menu/restdigi without any DB check', async () => {
    const res = await middleware(makeRequest('/menu/restdigi'));
    expect(__mocks.from).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('passes through /menu/demo-restaurant without any DB check', async () => {
    const res = await middleware(makeRequest('/menu/demo-restaurant'));
    expect(__mocks.from).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Active subscription — request should pass through
// ══════════════════════════════════════════════════════════════════════════════
describe('middleware — active subscription', () => {
  const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    jest.clearAllMocks();
    setRestaurantResult({
      id: 'rest-1',
      expiry_date: futureDate,
      subscription_status: 'active',
    });
  });

  it('passes the request through (returns NextResponse.next)', async () => {
    const res = await middleware(makeRequest('/menu/golden-spoon'));
    expect(res.status).toBe(200);
  });

  it('does NOT serve an HTML maintenance page for an active subscription', async () => {
    const res = await middleware(makeRequest('/menu/golden-spoon'));
    const body = await res.text();
    expect(body).not.toMatch(/<html/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Expired subscription — should block with HTML maintenance page
// ══════════════════════════════════════════════════════════════════════════════
describe('middleware — expired subscription', () => {
  const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago

  beforeEach(() => {
    jest.clearAllMocks();
    setRestaurantResult({
      id: 'rest-expired',
      expiry_date: pastDate,
      subscription_status: 'inactive',
    });
  });

  it('returns an HTML response for an expired inactive restaurant', async () => {
    const res = await middleware(makeRequest('/menu/expired-cafe'));
    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toContain('text/html');
  });

  it('includes a maintenance message in the HTML body', async () => {
    const res = await middleware(makeRequest('/menu/expired-cafe'));
    const html = await res.text();
    expect(html).toMatch(/maintenance|manual|subscription/i);
  });

  it('returns HTTP 200 (not a redirect) for the maintenance page', async () => {
    const res = await middleware(makeRequest('/menu/expired-cafe'));
    expect(res.status).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Restaurant not found
// ══════════════════════════════════════════════════════════════════════════════
describe('middleware — restaurant not found', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setRestaurantResult(null);
  });

  it('passes through when the slug has no matching restaurant in DB', async () => {
    const res = await middleware(makeRequest('/menu/unknown-slug'));
    const contentType = res.headers.get('content-type') ?? '';
    expect(res.status).toBe(200);
    expect(contentType).not.toContain('text/html');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Supabase error — fail-open (do not block the user on DB errors)
// ══════════════════════════════════════════════════════════════════════════════
describe('middleware — Supabase error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __mocks.single.mockRejectedValue(new Error('Network timeout'));
  });

  it('passes the request through when Supabase throws (fail-open)', async () => {
    const res = await middleware(makeRequest('/menu/some-restaurant'));
    expect(res.status).toBe(200);
  });
});
