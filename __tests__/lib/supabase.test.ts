import '@testing-library/jest-dom';

// ─── Mock @supabase/supabase-js ───────────────────────────────────────────────
jest.mock('@supabase/supabase-js', () => {
  // Storage mocks
  const mockUpload = jest.fn();
  const mockGetPublicUrl = jest.fn();
  const mockRemove = jest.fn();

  // DB mocks
  const mockInsert = jest.fn();
  const mockGetUser = jest.fn();
  const mockSingle = jest.fn();
  const mockEq = jest.fn(() => ({ single: mockSingle }));
  const mockSelect = jest.fn(() => ({ eq: mockEq }));
  const mockFrom = jest.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
  }));

  // Realtime mocks
  const mockSend = jest.fn();
  const mockSubscribe = jest.fn();
  const mockChannel = jest.fn(() => ({ subscribe: mockSubscribe, send: mockSend }));
  const mockRemoveChannel = jest.fn();

  return {
    createClient: jest.fn(() => ({
      storage: {
        from: jest.fn(() => ({
          upload: mockUpload,
          getPublicUrl: mockGetPublicUrl,
          remove: mockRemove,
        })),
      },
      from: mockFrom,
      auth: { getUser: mockGetUser },
      channel: mockChannel,
      removeChannel: mockRemoveChannel,
    })),
    // Expose all inner mocks for test configuration
    __mocks: {
      mockUpload, mockGetPublicUrl, mockRemove,
      mockInsert, mockGetUser, mockSingle, mockEq, mockSelect, mockFrom,
      mockSend, mockSubscribe, mockChannel, mockRemoveChannel,
    },
  };
});

// ─── Import module under test AFTER mocks are registered ─────────────────────
import {
  uploadDishImage,
  removeDishImage,
  broadcastMenuUpdate,
  logAdminAction,
} from '@/lib/supabase';

// Typed access to the inner mock functions
type Mocks = {
  mockUpload: jest.Mock; mockGetPublicUrl: jest.Mock; mockRemove: jest.Mock;
  mockInsert: jest.Mock; mockGetUser: jest.Mock; mockSingle: jest.Mock;
  mockEq: jest.Mock; mockSelect: jest.Mock; mockFrom: jest.Mock;
  mockSend: jest.Mock; mockSubscribe: jest.Mock; mockChannel: jest.Mock;
  mockRemoveChannel: jest.Mock;
};

const { __mocks } = jest.requireMock('@supabase/supabase-js') as { __mocks: Mocks };
const {
  mockUpload, mockGetPublicUrl, mockRemove,
  mockInsert, mockGetUser, mockSingle, mockFrom,
  mockSend, mockSubscribe, mockChannel, mockRemoveChannel,
} = __mocks;

// ─── Test helper ──────────────────────────────────────────────────────────────
function makeFile(name: string, type = 'image/png'): File {
  return new File(['(binary)'], name, { type });
}

// ══════════════════════════════════════════════════════════════════════════════
// uploadDishImage
// ══════════════════════════════════════════════════════════════════════════════
describe('uploadDishImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://cdn.example.com/public/abc_123.png' },
    });
  });

  it('uploads the file and returns the public URL', async () => {
    const url = await uploadDishImage(makeFile('dish-photo.png'));
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(url).toBe('https://cdn.example.com/public/abc_123.png');
  });

  it('stores the file under the public/ prefix', async () => {
    await uploadDishImage(makeFile('test.jpg'));
    const [filePath] = mockUpload.mock.calls[0] as [string];
    expect(filePath).toMatch(/^public\//);
  });

  it('generates a unique filename on every call (no collisions)', async () => {
    const paths: string[] = [];
    for (let i = 0; i < 5; i++) {
      await uploadDishImage(makeFile(`image-${i}.jpg`));
      paths.push((mockUpload.mock.calls[i] as [string])[0]);
    }
    expect(new Set(paths).size).toBe(5);
  });

  it('preserves the original file extension in the stored filename', async () => {
    await uploadDishImage(makeFile('photo.webp'));
    const [filePath] = mockUpload.mock.calls[0] as [string];
    expect(filePath).toMatch(/\.webp$/);
  });

  it('accepts a custom bucket name without error', async () => {
    await expect(uploadDishImage(makeFile('test.jpg'), 'menu-images')).resolves.toBeDefined();
  });

  it('throws when the Supabase upload returns an error', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'Storage limit exceeded' } });
    await expect(uploadDishImage(makeFile('fail.png'))).rejects.toThrow('Failed to upload image');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// removeDishImage
// ══════════════════════════════════════════════════════════════════════════════
describe('removeDishImage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRemove.mockResolvedValue({ error: null });
  });

  it('extracts the correct file path from the public URL and deletes it', async () => {
    const url = 'https://xyz.supabase.co/storage/v1/object/public/dishes/public/abc_123.png';
    await removeDishImage(url);
    expect(mockRemove).toHaveBeenCalledWith(['public/abc_123.png']);
  });

  it('does not call remove() when the URL format is not recognised', async () => {
    await removeDishImage('https://other-cdn.example.com/image.png');
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('does not throw when the URL is unrecognised (graceful no-op)', async () => {
    await expect(
      removeDishImage('https://other-cdn.example.com/image.png')
    ).resolves.not.toThrow();
  });

  it('does not throw when Supabase remove() returns an error', async () => {
    mockRemove.mockResolvedValue({ error: { message: 'Object not found' } });
    const url = 'https://xyz.supabase.co/storage/v1/object/public/dishes/public/gone.png';
    await expect(removeDishImage(url)).resolves.not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// broadcastMenuUpdate
// ══════════════════════════════════════════════════════════════════════════════
describe('broadcastMenuUpdate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockSend.mockReturnValue(undefined);
    mockSubscribe.mockImplementation((cb: (status: string) => void) => {
      cb('SUBSCRIBED');
      return { send: mockSend };
    });
    mockChannel.mockReturnValue({ subscribe: mockSubscribe, send: mockSend });
    mockRemoveChannel.mockReturnValue(undefined);
  });

  afterEach(() => jest.useRealTimers());

  it('creates a realtime channel scoped to the restaurant slug', () => {
    broadcastMenuUpdate('my-restaurant');
    expect(mockChannel).toHaveBeenCalledWith('public-data-my-restaurant');
  });

  it('sends a refresh-menu broadcast event when subscribed', () => {
    broadcastMenuUpdate('my-restaurant');
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'broadcast', event: 'refresh-menu' })
    );
  });

  it('broadcast payload includes a timestamp', () => {
    broadcastMenuUpdate('my-restaurant');
    const call = mockSend.mock.calls[0][0] as { payload: { timestamp: number } };
    expect(typeof call.payload.timestamp).toBe('number');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// logAdminAction
// ══════════════════════════════════════════════════════════════════════════════
describe('logAdminAction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('silently returns when the user is not authenticated (no DB call)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(logAdminAction('DISH_ADDED', 'Added Paneer Tikka')).resolves.not.toThrow();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('inserts an activity_log row with the correct action_type and description', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    mockSingle.mockResolvedValue({ data: { id: 'rest-456' }, error: null });

    const insertResult = { error: null };
    mockInsert.mockResolvedValue(insertResult);

    await logAdminAction('DISH_DELETED', 'Deleted Butter Chicken');

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: 'DISH_DELETED',
        description: 'Deleted Butter Chicken',
        admin_id: 'user-123',
      })
    );
  });

  it('does not throw when the activity_logs insert fails (silent failure)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } } });
    mockSingle.mockResolvedValue({ data: { id: 'rest-999' }, error: null });
    mockInsert.mockResolvedValue({ error: { message: 'DB write failed' } });

    await expect(
      logAdminAction('SETTINGS_CHANGED', 'Changed restaurant name')
    ).resolves.not.toThrow();
  });

  it('does not throw when the restaurant lookup returns no data', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-xyz' } } });
    mockSingle.mockResolvedValue({ data: null, error: null });

    await expect(
      logAdminAction('MENU_UPDATED', 'Updated menu order')
    ).resolves.not.toThrow();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
