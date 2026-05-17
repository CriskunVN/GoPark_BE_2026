jest.mock('../parking-lot/entities/parking-lot.entity', () => ({
  ParkingLot: class ParkingLot {},
}));

import { ChatbotService } from './chatbot.service';
import { ChatbotStateService } from './chatbot-state.service';

function createSessionRepoMock() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: 'session-1', ...value })),
    update: jest.fn(),
    delete: jest.fn(),
  } as any;
}

describe('Chatbot LLM + RAG + function calling pipeline', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('injects RAG context, lets the LLM call a data function, then returns the synthesized answer with data', async () => {
    const knowledge = {
      buildContext: jest.fn(() => 'Tai lieu 1: Cach chon bai\nUu tien bai con cho, gia hop ly va danh gia tot.'),
      answerFromKnowledge: jest.fn(),
    };
    const guide = {
      getGuide: jest.fn(() => 'GoPark chatbot guide.'),
    };
    const createCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-search-1',
                  type: 'function',
                  function: {
                    name: 'search_parking',
                    arguments: JSON.stringify({ criteria: 'best_rating', limit: 2 }),
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content:
                'Minh goi du lieu he thong va thay GoPark My Khe dang phu hop nhat: con 18/40 cho, danh gia 4.8 sao.',
            },
          },
        ],
      });

    const service = new ChatbotService(
      { query: jest.fn() } as any,
      new ChatbotStateService(),
      guide as any,
      createSessionRepoMock(),
      knowledge as any,
    );
    (service as any).groq = {
      chat: { completions: { create: createCompletion } },
    };
    (service as any).getParkingLotsRaw = jest.fn(async () => [
      {
        id: 11,
        name: 'GoPark My Khe',
        address: 'Vo Nguyen Giap, Da Nang',
        available_slots: 18,
        total_slots: 40,
        hourly_rate: 20000,
        avgRating: 4.8,
      },
      {
        id: 12,
        name: 'GoPark Nguyen Hue',
        address: 'Quan 1, TP HCM',
        available_slots: 5,
        total_slots: 30,
        hourly_rate: 25000,
        avgRating: 4.1,
      },
    ]);

    const result = await service.processMessage(
      [{ role: 'user', content: 'toi dang phan van nen gui xe the nao' }],
      'user-1',
    );

    expect(knowledge.buildContext).toHaveBeenCalledWith('toi dang phan van nen gui xe the nao', 4);
    expect(createCompletion).toHaveBeenCalledTimes(2);

    const firstCall = createCompletion.mock.calls[0][0];
    expect(firstCall.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: 'search_parking' }) }),
    ]));
    expect(firstCall.messages[0].content).toContain('RAG CONTEXT LIEN QUAN');
    expect(firstCall.messages[0].content).toContain('Uu tien bai con cho');

    const secondCall = createCompletion.mock.calls[1][0];
    expect(secondCall.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          tool_call_id: 'call-search-1',
          name: 'search_parking',
        }),
      ]),
    );
    const toolMessage = secondCall.messages.find((message: any) => message.role === 'tool');
    expect(toolMessage.content).toContain('GoPark My Khe');

    expect(result.action).toBe('list_parking');
    expect(result.text).toContain('GoPark My Khe');
    expect(result.data.lots).toHaveLength(2);
  });

  it('uses RAG + LLM without tools for static guide questions', async () => {
    const knowledge = {
      buildContext: jest.fn(() => 'Tai lieu 1: Thanh toan\nGoPark ho tro thanh toan qua VNPAY, vi va tien mat.'),
      answerFromKnowledge: jest.fn(),
    };
    const guide = {
      getGuide: jest.fn(() => 'GoPark chatbot guide.'),
    };
    const createCompletion = jest.fn().mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Ban co the thanh toan bang VNPAY, vi GoPark hoac tien mat tuy bai do ho tro.',
          },
        },
      ],
    });

    const service = new ChatbotService(
      { query: jest.fn() } as any,
      new ChatbotStateService(),
      guide as any,
      createSessionRepoMock(),
      knowledge as any,
    );
    (service as any).groq = {
      chat: { completions: { create: createCompletion } },
    };

    const result = await service.processMessage(
      [{ role: 'user', content: 'huong dan thanh toan vnpay nhu the nao' }],
      'user-1',
    );

    expect(createCompletion).toHaveBeenCalledTimes(1);
    expect(createCompletion.mock.calls[0][0].tools).toBeUndefined();
    expect(result.action).toBeUndefined();
    expect(result.text).toContain('VNPAY');
  });

  it('retries without tools when the provider rejects a generated tool call', async () => {
    const knowledge = {
      buildContext: jest.fn(() => 'Tai lieu 1: Goi y\nUu tien bai gan va con cho.'),
      answerFromKnowledge: jest.fn(),
    };
    const guide = {
      getGuide: jest.fn(() => 'GoPark chatbot guide.'),
    };
    const createCompletion = jest
      .fn()
      .mockRejectedValueOnce({ error: { code: 'tool_use_failed' } })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Nen chon bai con cho, gia hop ly va gan diem den cua ban.',
            },
          },
        ],
      });

    const service = new ChatbotService(
      { query: jest.fn() } as any,
      new ChatbotStateService(),
      guide as any,
      createSessionRepoMock(),
      knowledge as any,
    );
    (service as any).groq = {
      chat: { completions: { create: createCompletion } },
    };

    const result = await service.processMessage(
      [{ role: 'user', content: 'toi dang phan van nen gui xe the nao' }],
      'user-1',
    );

    expect(createCompletion).toHaveBeenCalledTimes(2);
    expect(createCompletion.mock.calls[0][0].tools).toBeDefined();
    expect(createCompletion.mock.calls[1][0].tools).toBeUndefined();
    expect(result.text).toContain('Nen chon bai');
  });
});
