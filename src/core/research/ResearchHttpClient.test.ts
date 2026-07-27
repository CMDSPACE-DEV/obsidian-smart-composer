import { requestUrl } from 'obsidian'

import { ResearchHttpClient } from './ResearchHttpClient'

const requestUrlMock = requestUrl as jest.MockedFunction<typeof requestUrl>

describe('ResearchHttpClient', () => {
  beforeEach(() => {
    requestUrlMock.mockReset()
  })

  it('does not expose a credential-bearing URL after a network failure', async () => {
    requestUrlMock.mockRejectedValue(
      new Error(
        'Failed to fetch https://example.test/search?crtfc_key=private-value',
      ),
    )

    await expect(
      new ResearchHttpClient().request('opendart', {
        url: 'https://example.test/search?crtfc_key=private-value',
      }),
    ).rejects.toThrow(
      'opendart: Network request failed before a response was received.',
    )
  })

  it('redacts credential fields in provider error bodies', async () => {
    requestUrlMock.mockResolvedValue({
      status: 403,
      headers: {},
      text: '{"crtfc_key":"private-value","message":"denied"}',
      json: {},
      arrayBuffer: new ArrayBuffer(0),
    })

    await expect(
      new ResearchHttpClient().request('opendart', {
        url: 'https://example.test/search',
      }),
    ).rejects.not.toThrow('private-value')
  })

  it('explains that NAVER provider errorCode 200 is an authentication failure', async () => {
    requestUrlMock.mockResolvedValue({
      status: 401,
      headers: {},
      text: JSON.stringify({
        error: {
          errorCode: '200',
          message: 'Authentication Failed',
          details: 'Authentication information are missing.',
        },
      }),
      json: {},
      arrayBuffer: new ArrayBuffer(0),
    })

    await expect(
      new ResearchHttpClient().request('naver', {
        url: 'https://naverapihub.apigw.ntruss.com/search/v1/news',
      }),
    ).rejects.toThrow('not HTTP 200 success')
  })
})
