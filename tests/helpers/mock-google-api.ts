import { mock } from "bun:test";

/**
 * Mock Google Calendar API client
 * Provides mock implementations of commonly used Calendar API methods
 */
export function createMockCalendarAPI() {
  return {
    events: {
      list: mock(
        async ({ calendarId, timeMin, timeMax, maxResults, singleEvents, orderBy, q }: any) =>
          Promise.resolve({
            data: {
              items: [],
              nextPageToken: undefined,
            },
          })
      ),
      get: mock(
        async ({ calendarId, eventId }: any) =>
          Promise.resolve({
            data: {
              id: eventId,
              summary: "Test Event",
              start: { dateTime: new Date().toISOString() },
              end: { dateTime: new Date(Date.now() + 3600000).toISOString() },
            },
          })
      ),
      insert: mock(
        async ({ calendarId, requestBody }: any) =>
          Promise.resolve({
            data: {
              id: "mock-event-id",
              ...requestBody,
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
            },
          })
      ),
      update: mock(
        async ({ calendarId, eventId, requestBody }: any) =>
          Promise.resolve({
            data: {
              id: eventId,
              ...requestBody,
              updated: new Date().toISOString(),
            },
          })
      ),
      delete: mock(
        async ({ calendarId, eventId }: any) =>
          Promise.resolve({
            data: {},
          })
      ),
      import: mock(
        async ({ calendarId, requestBody }: any) =>
          Promise.resolve({
            data: {
              id: "mock-imported-id",
              ...requestBody,
            },
          })
      ),
      quickAdd: mock(
        async ({ calendarId, text }: any) =>
          Promise.resolve({
            data: {
              id: "mock-quick-add-id",
              summary: text,
              created: new Date().toISOString(),
            },
          })
      ),
    },
    calendars: {
      list: mock(
        async ({ minAccessRole }: any) =>
          Promise.resolve({
            data: {
              items: [],
            },
          })
      ),
      get: mock(
        async ({ calendarId }: any) =>
          Promise.resolve({
            data: {
              id: calendarId,
              summary: "Test Calendar",
              description: "A test calendar",
              timeZone: "UTC",
            },
          })
      ),
      insert: mock(
        async ({ requestBody }: any) =>
          Promise.resolve({
            data: {
              id: "mock-calendar-id",
              ...requestBody,
              created: new Date().toISOString(),
            },
          })
      ),
      delete: mock(
        async ({ calendarId }: any) =>
          Promise.resolve({
            data: {},
          })
      ),
    },
    calendarList: {
      list: mock(
        async () =>
          Promise.resolve({
            data: {
              items: [],
            },
          })
      ),
      get: mock(
        async ({ calendarId }: any) =>
          Promise.resolve({
            data: {
              id: calendarId,
              summary: "Test Calendar",
              accessRole: "owner",
            },
          })
      ),
    },
    freebusy: {
      query: mock(
        async ({ requestBody }: any) =>
          Promise.resolve({
            data: {
              calendars: {},
              timeMin: requestBody.timeMin,
              timeMax: requestBody.timeMax,
            },
          })
      ),
    },
  };
}

/**
 * Mock Google Gmail API client
 * Provides mock implementations of commonly used Gmail API methods
 */
export function createMockGmailAPI() {
  return {
    users: {
      messages: {
        list: mock(
          async ({ userId, q, maxResults, labelIds }: any) =>
            Promise.resolve({
              data: {
                messages: [],
                nextPageToken: undefined,
                resultSizeEstimate: 0,
              },
            })
        ),
        get: mock(
          async ({ userId, id, format }: any) =>
            Promise.resolve({
              data: {
                id,
                threadId: "thread-id",
                labelIds: ["INBOX"],
                snippet: "Test message",
                payload: {
                  headers: [
                    { name: "Subject", value: "Test Subject" },
                    { name: "From", value: "sender@example.com" },
                  ],
                  parts: [
                    {
                      mimeType: "text/plain",
                      body: { data: Buffer.from("Test body").toString("base64") },
                    },
                  ],
                },
              },
            })
        ),
        send: mock(
          async ({ userId, requestBody }: any) =>
            Promise.resolve({
              data: {
                id: "mock-message-id",
                threadId: "mock-thread-id",
                labelIds: ["SENT"],
              },
            })
        ),
        modify: mock(
          async ({ userId, id, requestBody }: any) =>
            Promise.resolve({
              data: {
                id,
                threadId: "thread-id",
                labelIds: requestBody.addLabelIds || [],
              },
            })
        ),
        trash: mock(
          async ({ userId, id }: any) =>
            Promise.resolve({
              data: {
                id,
                labelIds: ["TRASH"],
              },
            })
        ),
        delete: mock(
          async ({ userId, id }: any) =>
            Promise.resolve({
              data: {},
            })
        ),
        batchModify: mock(
          async ({ userId, requestBody }: any) =>
            Promise.resolve({
              data: {},
            })
        ),
        batchDelete: mock(
          async ({ userId, requestBody }: any) =>
            Promise.resolve({
              data: {},
            })
        ),
      },
      threads: {
        list: mock(
          async ({ userId, q, maxResults, labelIds }: any) =>
            Promise.resolve({
              data: {
                threads: [],
                nextPageToken: undefined,
                resultSizeEstimate: 0,
              },
            })
        ),
        get: mock(
          async ({ userId, id, format }: any) =>
            Promise.resolve({
              data: {
                id,
                messages: [
                  {
                    id: "msg-1",
                    threadId: id,
                    labelIds: ["INBOX"],
                    snippet: "Test message",
                  },
                ],
                snippet: "Test thread",
              },
            })
        ),
        trash: mock(
          async ({ userId, id }: any) =>
            Promise.resolve({
              data: {
                id,
              },
            })
        ),
        untrash: mock(
          async ({ userId, id }: any) =>
            Promise.resolve({
              data: {
                id,
              },
            })
        ),
      },
      labels: {
        list: mock(
          async ({ userId }: any) =>
            Promise.resolve({
              data: {
                labels: [],
              },
            })
        ),
        get: mock(
          async ({ userId, id }: any) =>
            Promise.resolve({
              data: {
                id,
                name: "Test Label",
                messageListVisibility: "labelShow",
              },
            })
        ),
        create: mock(
          async ({ userId, requestBody }: any) =>
            Promise.resolve({
              data: {
                id: "mock-label-id",
                ...requestBody,
              },
            })
        ),
        delete: mock(
          async ({ userId, id }: any) =>
            Promise.resolve({
              data: {},
            })
        ),
        update: mock(
          async ({ userId, id, requestBody }: any) =>
            Promise.resolve({
              data: {
                id,
                ...requestBody,
              },
            })
        ),
      },
      getProfile: mock(
        async ({ userId }: any) =>
          Promise.resolve({
            data: {
              emailAddress: "test@example.com",
              messagesTotal: 100,
              threadsTotal: 50,
              historyId: "1234567890",
            },
          })
      ),
      drafts: {
        list: mock(
          async ({ userId }: any) =>
            Promise.resolve({
              data: {
                drafts: [],
              },
            })
        ),
        get: mock(
          async ({ userId, id }: any) =>
            Promise.resolve({
              data: {
                id,
                message: {
                  id: "msg-id",
                  threadId: "thread-id",
                  labelIds: ["DRAFT"],
                },
              },
            })
        ),
      },
      watch: mock(
        async ({ userId, requestBody }: any) =>
          Promise.resolve({
            data: {
              historyId: "1234567890",
              expiration: Date.now() + 86400000,
            },
          })
      ),
    },
  };
}

/**
 * Mock Google People API client
 * Provides mock implementations of commonly used People API methods
 */
export function createMockPeopleAPI() {
  return {
    people: {
      connections: {
        list: mock(
          async ({ resourceName, pageSize, sortOrder, personFields }: any) =>
            Promise.resolve({
              data: {
                connections: [],
                nextPageToken: undefined,
              },
            })
        ),
        batchGetWithFullNames: mock(
          async ({ resourceNames, personFields }: any) =>
            Promise.resolve({
              data: {
                responses: [],
              },
            })
        ),
      },
      batchGetContacts: mock(
        async ({ resourceNames, personFields }: any) =>
          Promise.resolve({
            data: {
              responses: [],
            },
          })
      ),
      createContact: mock(
        async ({ requestBody }: any) =>
          Promise.resolve({
            data: {
              resourceName: "people/mock-id",
              etag: "mock-etag",
              ...requestBody,
            },
          })
      ),
      updateContact: mock(
        async ({ resourceName, updatePersonFields, requestBody }: any) =>
          Promise.resolve({
            data: {
              resourceName,
              etag: "updated-etag",
              ...requestBody,
            },
          })
      ),
      deleteContact: mock(
        async ({ resourceName }: any) =>
          Promise.resolve({
            data: {},
          })
      ),
      searchContacts: mock(
        async ({ query, pageSize, readMask }: any) =>
          Promise.resolve({
            data: {
              results: [],
              nextPageToken: undefined,
            },
          })
      ),
      searchDirectoryPeople: mock(
        async ({ query, pageSize, readMask }: any) =>
          Promise.resolve({
            data: {
              people: [],
              nextPageToken: undefined,
            },
          })
      ),
      copyOtherContactToMyContactsGroup: mock(
        async ({ resourceName, requestBody }: any) =>
          Promise.resolve({
            data: {
              resourceName: "people/copied-id",
            },
          })
      ),
    },
    contactGroups: {
      create: mock(
        async ({ requestBody }: any) =>
          Promise.resolve({
            data: {
              resourceName: "contactGroups/mock-group-id",
              etag: "mock-etag",
              ...requestBody,
            },
          })
      ),
      delete: mock(
        async ({ resourceName }: any) =>
          Promise.resolve({
            data: {},
          })
      ),
      get: mock(
        async ({ resourceName, maxMembers }: any) =>
          Promise.resolve({
            data: {
              resourceName,
              etag: "mock-etag",
              name: "Test Group",
              memberCount: 0,
            },
          })
      ),
      list: mock(
        async ({ pageSize, pageToken }: any) =>
          Promise.resolve({
            data: {
              contactGroups: [],
              nextPageToken: undefined,
            },
          })
      ),
      update: mock(
        async ({ resourceName, requestBody }: any) =>
          Promise.resolve({
            data: {
              resourceName,
              etag: "updated-etag",
              ...requestBody,
            },
          })
      ),
      members: {
        modify: mock(
          async ({ resourceName, requestBody }: any) =>
            Promise.resolve({
              data: {},
            })
        ),
      },
    },
    otherContacts: {
      list: mock(
        async ({ pageSize, pageToken, readMask, sources }: any) =>
          Promise.resolve({
            data: {
              otherContacts: [],
              nextPageToken: undefined,
            },
          })
      ),
      search: mock(
        async ({ query, pageSize, readMask }: any) =>
          Promise.resolve({
            data: {
              results: [],
              nextPageToken: undefined,
            },
          })
      ),
    },
  };
}

/**
 * Create a complete mock Google API client with all services
 */
export function createMockGoogleAPIClient() {
  return {
    calendar: () => createMockCalendarAPI(),
    gmail: () => createMockGmailAPI(),
    people: () => createMockPeopleAPI(),
    auth: {
      OAuth2: mock(function () {
        this.setCredentials = mock(() => {});
        this.getAccessToken = mock(async () => ({
          token: "mock-access-token",
        }));
        this.refreshAccessToken = mock(async () => ({
          credentials: {
            access_token: "mock-refreshed-token",
            refresh_token: "mock-refresh-token",
            expiry_date: Date.now() + 3600000,
          },
        }));
      }),
    },
  };
}
