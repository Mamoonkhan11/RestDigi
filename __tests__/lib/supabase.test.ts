/**
 * @jest-environment node
 */
import {
  supabase,
  uploadDishImage,
  removeDishImage,
  broadcastMenuUpdate,
  logAdminAction,
  getDishesByRestaurantSlug,
  getDishesForAdmin,
  updateDishAvailability,
  deleteDishFromDb,
} from '@/lib/supabase';

function makeFile(name: string, type = 'image/png'): File {
  return new File(['(binary-data)'], name, { type });
}

describe('lib/supabase — real Supabase client & utility functions', () => {
  const originalFetch = global.fetch;

  afterEach(async () => {
    global.fetch = originalFetch;
    await supabase.removeAllChannels();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await supabase.removeAllChannels();
    supabase.realtime?.disconnect();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 1. Client Initialization
  // ════════════════════════════════════════════════════════════════════════════
  describe('Supabase client instance', () => {
    it('initializes a real SupabaseClient instance with expected services', () => {
      expect(supabase).toBeDefined();
      expect(typeof supabase.from).toBe('function');
      expect(typeof supabase.storage.from).toBe('function');
      expect(typeof supabase.auth.getUser).toBe('function');
      expect(typeof supabase.channel).toBe('function');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Storage: uploadDishImage
  // ════════════════════════════════════════════════════════════════════════════
  describe('uploadDishImage', () => {
    it('uploads to public/ path and returns the generated public URL', async () => {
      let uploadedPath = '';
      global.fetch = (async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/storage/v1/object/dishes/')) {
          uploadedPath = urlStr;
          return new Response(JSON.stringify({ Key: 'dishes/public/photo.png' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(null, { status: 200 });
      }) as any;

      const url = await uploadDishImage(makeFile('curry.jpg'));
      expect(url).toContain('/storage/v1/object/public/dishes/public/');
      expect(url).toMatch(/\.jpg$/);
      expect(uploadedPath).toContain('/storage/v1/object/dishes/public/');
    });

    it('generates unique filenames to prevent collisions', async () => {
      const urls: string[] = [];
      global.fetch = (async () => {
        return new Response(JSON.stringify({ Key: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as any;

      for (let i = 0; i < 5; i++) {
        const url = await uploadDishImage(makeFile(`dish-${i}.png`));
        urls.push(url);
      }
      expect(new Set(urls).size).toBe(5);
    });

    it('throws error when storage upload fails', async () => {
      global.fetch = (async () => {
        return new Response(
          JSON.stringify({ statusCode: '413', message: 'Payload too large', error: 'Payload too large' }),
          { status: 413, headers: { 'content-type': 'application/json' } }
        );
      }) as any;

      await expect(uploadDishImage(makeFile('large-image.png'))).rejects.toThrow('Failed to upload image');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. Storage: removeDishImage
  // ════════════════════════════════════════════════════════════════════════════
  describe('removeDishImage', () => {
    it('extracts the file path and calls storage delete endpoint', async () => {
      let deleteCalled = false;
      let deleteBody = '';

      global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          deleteCalled = true;
          deleteBody = String(init.body);
          return new Response(JSON.stringify([{ name: 'public/abc_123.png' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(null, { status: 200 });
      }) as any;

      const testUrl = 'https://demo-test.supabase.co/storage/v1/object/public/dishes/public/abc_123.png';
      await removeDishImage(testUrl);

      expect(deleteCalled).toBe(true);
      expect(deleteBody).toContain('public/abc_123.png');
    });

    it('gracefully ignores non-supabase URLs without throwing', async () => {
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;

      await expect(removeDishImage('https://images.unsplash.com/photo-123')).resolves.not.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('gracefully handles storage delete errors without unhandled rejection', async () => {
      global.fetch = (async () => {
        return new Response(
          JSON.stringify({ statusCode: '404', message: 'Object not found' }),
          { status: 404, headers: { 'content-type': 'application/json' } }
        );
      }) as any;

      const testUrl = 'https://demo-test.supabase.co/storage/v1/object/public/dishes/public/missing.png';
      await expect(removeDishImage(testUrl)).resolves.not.toThrow();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 4. Database: getDishesByRestaurantSlug
  // ════════════════════════════════════════════════════════════════════════════
  describe('getDishesByRestaurantSlug', () => {
    it('fetches dishes linked by restaurant_id when restaurant exists', async () => {
      global.fetch = (async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/rest/v1/restaurants')) {
          return new Response(JSON.stringify({ id: 'rest-uuid-101' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (urlStr.includes('/rest/v1/dishes')) {
          return new Response(
            JSON.stringify([
              { id: 'dish-1', name: 'Paneer Butter Masala', category: 'Curry', price: 280, is_available: true },
              { id: 'dish-2', name: 'Garlic Naan', category: 'Breads', price: 60, is_available: true },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(null, { status: 200 });
      }) as any;

      const dishes = await getDishesByRestaurantSlug('spice-garden');
      expect(dishes).toHaveLength(2);
      expect(dishes[0].name).toBe('Paneer Butter Masala');
      expect(dishes[1].name).toBe('Garlic Naan');
    });

    it('throws when the database query fails', async () => {
      global.fetch = (async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/rest/v1/restaurants')) {
          return new Response(JSON.stringify({ id: 'rest-uuid-101' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({ code: '42P01', message: 'relation "dishes" does not exist' }),
          { status: 500, headers: { 'content-type': 'application/json' } }
        );
      }) as any;

      await expect(getDishesByRestaurantSlug('spice-garden')).rejects.toThrow();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 5. Database: getDishesForAdmin
  // ════════════════════════════════════════════════════════════════════════════
  describe('getDishesForAdmin', () => {
    it('throws "User not authenticated" when no auth session exists', async () => {
      jest.spyOn(supabase.auth, 'getUser').mockResolvedValueOnce({
        data: { user: null },
        error: null,
      } as any);

      await expect(getDishesForAdmin()).rejects.toThrow('User not authenticated');
    });

    it('returns empty array when authenticated user has no restaurant record', async () => {
      jest.spyOn(supabase.auth, 'getUser').mockResolvedValueOnce({
        data: { user: { id: 'admin-user-123' } as any },
        error: null,
      });

      global.fetch = (async () => {
        return new Response(
          JSON.stringify({ code: 'PGRST116', message: '0 rows' }),
          { status: 406, headers: { 'content-type': 'application/json' } }
        );
      }) as any;

      const dishes = await getDishesForAdmin();
      expect(dishes).toEqual([]);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 6. Database: logAdminAction
  // ════════════════════════════════════════════════════════════════════════════
  describe('logAdminAction', () => {
    it('silently ignores unauthenticated calls', async () => {
      jest.spyOn(supabase.auth, 'getUser').mockResolvedValueOnce({
        data: { user: null },
        error: null,
      } as any);

      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as any;

      await expect(logAdminAction('DISH_ADDED', 'Created dish')).resolves.not.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('inserts activity log when authenticated', async () => {
      jest.spyOn(supabase.auth, 'getUser').mockResolvedValueOnce({
        data: { user: { id: 'admin-1' } as any },
        error: null,
      });

      let insertBody = '';
      global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/rest/v1/restaurants')) {
          return new Response(JSON.stringify({ id: 'rest-1' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (urlStr.includes('/rest/v1/activity_logs') && init?.method === 'POST') {
          insertBody = String(init.body);
          return new Response(JSON.stringify({ id: 'log-1' }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(null, { status: 200 });
      }) as any;

      await logAdminAction('PRICE_UPDATED', 'Updated prices for combo');
      expect(insertBody).toContain('PRICE_UPDATED');
      expect(insertBody).toContain('Updated prices for combo');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 7. Realtime: broadcastMenuUpdate
  // ════════════════════════════════════════════════════════════════════════════
  describe('broadcastMenuUpdate', () => {
    it('creates a realtime channel with correct topic and dispatches refresh', () => {
      jest.useFakeTimers();
      const channel = supabase.channel('public-data-test-slug');
      expect(channel.topic).toBe('realtime:public-data-test-slug');
      expect(typeof channel.subscribe).toBe('function');
      expect(typeof channel.send).toBe('function');

      const sendSpy = jest.spyOn(channel, 'send').mockImplementation(() => Promise.resolve('ok' as any));
      const subscribeSpy = jest.spyOn(channel, 'subscribe').mockImplementation(((callback?: (status: string) => void) => {
        if (callback) callback('SUBSCRIBED');
        return channel;
      }) as any);
      const channelSpy = jest.spyOn(supabase, 'channel').mockReturnValue(channel);

      broadcastMenuUpdate('test-slug');

      expect(channelSpy).toHaveBeenCalledWith('public-data-test-slug');
      expect(subscribeSpy).toHaveBeenCalled();
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'broadcast',
          event: 'refresh-menu',
        })
      );

      jest.advanceTimersByTime(1500);
      jest.useRealTimers();
    });
  });
});
