import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import { TokenStore } from "./token-store.ts";
import { ensureCredentialsExist } from "../utils/setup-guide.ts";
import type {
  PeopleClient,
  AuthClient,
  Person,
  ContactGroup,
  ListContactsOptions,
  SearchContactsOptions,
  CreateContactOptions,
  MergeOptions,
  DuplicateOptions,
} from "../types/google-apis.ts";

export class ContactsService {
  private people: PeopleClient | null = null;
  private auth: AuthClient | null = null;
  private readonly SCOPES: string[];
  private tokenStore: TokenStore;
  private account: string;

  private readonly DEFAULT_PERSON_FIELDS = [
    "names",
    "emailAddresses",
    "phoneNumbers",
    "addresses",
    "organizations",
    "photos",
    "birthdays",
    "relations",
    "metadata",
  ].join(",");

  constructor(account: string = "default") {
    this.account = account;
    this.tokenStore = TokenStore.getInstance();
    this.SCOPES = [
      "https://www.googleapis.com/auth/contacts",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/contacts.other.readonly",
    ];
  }

  async initialize() {
    if (this.people) return;

    const CREDENTIALS_PATH = path.join(os.homedir(), ".credentials.json");

    // Check if credentials file exists and show setup guide if not
    if (!ensureCredentialsExist()) {
      process.exit(1);
    }

    // Try to load existing token first
    let auth = await this.loadSavedAuthIfExist();

    if (!auth) {
      // If no saved token, authenticate and save it
      try {
        auth = await authenticate({
          scopes: this.SCOPES,
          keyfilePath: CREDENTIALS_PATH,
        });
        await this.saveAuth(auth);
      } catch (error: unknown) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          console.error("\n❌ Error: Credentials file not found at " + CREDENTIALS_PATH);
          ensureCredentialsExist();
          process.exit(1);
        }
        throw error;
      }
    }

    this.auth = auth;
    this.people = google.people({ version: "v1", auth: this.auth });
  }

  private async loadSavedAuthIfExist() {
    try {
      const token = this.tokenStore.getToken("contacts", this.account);

      if (!token) {
        return null;
      }

      // Check if token has the required scopes
      const hasRequiredScopes = this.SCOPES.every((scope) =>
        token.scopes.includes(scope)
      );

      if (!hasRequiredScopes) {
        console.log(
          "Token has incorrect scopes. Deleting token to re-authenticate..."
        );
        this.tokenStore.deleteToken("contacts", this.account);
        return null;
      }

      // Load credentials to get client_id and client_secret
      const CREDENTIALS_PATH = path.join(os.homedir(), ".credentials.json");
      const credentialsContent = fs.readFileSync(CREDENTIALS_PATH, "utf8");
      const credentials = JSON.parse(credentialsContent);
      const clientConfig = credentials.installed || credentials.web;

      // Create auth object with client credentials
      const auth = new google.auth.OAuth2(
        clientConfig.client_id,
        clientConfig.client_secret,
        clientConfig.redirect_uris?.[0] || "http://localhost"
      );
      auth.setCredentials({
        refresh_token: token.refresh_token,
        access_token: token.access_token,
        expiry_date: token.expiry_date,
      });

      // Test if the token is still valid by making a simple request
      try {
        await auth.getAccessToken();
        console.log(`Using saved Contacts token (account: ${this.account})`);
        return auth;
      } catch (error) {
        // Token is expired or invalid, remove it
        console.log("Saved token is invalid. Re-authenticating...");
        this.tokenStore.deleteToken("contacts", this.account);
        return null;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("Failed to load saved token:", message);
      this.tokenStore.deleteToken("contacts", this.account);
    }
    return null;
  }

  private async saveAuth(auth: AuthClient) {
    try {
      this.tokenStore.saveToken({
        service: "contacts",
        account: this.account,
        access_token: auth.credentials.access_token,
        refresh_token: auth.credentials.refresh_token,
        expiry_date: auth.credentials.expiry_date,
        scopes: this.SCOPES,
      });
      console.log(`Contacts token saved (account: ${this.account})`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.warn("Failed to save token:", message);
    }
  }

  private parseResourceName(input: string): string {
    return input.startsWith("people/") ? input : `people/${input}`;
  }

  async listContacts(options: ListContactsOptions = {}): Promise<Person[]> {
    await this.initialize();

    const { pageSize = 50, pageToken = null, sortOrder = "LAST_NAME_ASCENDING" } =
      options;

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    try {
      const result = await this.people.people.connections.list({
        resourceName: "people/me",
        pageSize,
        pageToken: pageToken || undefined,
        personFields: this.DEFAULT_PERSON_FIELDS,
        sortOrder: sortOrder as any,
      });

      return result.data.connections || [];
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(
          "Permission denied: You don't have access to view contacts. Please check your permissions."
        );
      } else if (error instanceof Error) {
        throw new Error(`Failed to list contacts: ${error.message}`);
      }
      throw error;
    }
  }

  async getContact(resourceName: string): Promise<Person> {
    await this.initialize();

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    const fullResourceName = this.parseResourceName(resourceName);

    try {
      const result = await this.people.people.get({
        resourceName: fullResourceName,
        personFields: this.DEFAULT_PERSON_FIELDS,
      });

      if (!result.data) {
        throw new Error("No contact data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === 404) {
        throw new Error(`Contact not found: ${fullResourceName}`);
      } else if (error && typeof error === "object" && "code" in error && error.code === 403) {
        throw new Error(`Permission denied: You don't have access to contact ${fullResourceName}`);
      } else if (error instanceof Error) {
        throw new Error(`Failed to get contact: ${error.message}`);
      }
      throw error;
    }
  }

  async searchContacts(query: string, options: SearchContactsOptions = {}): Promise<Person[]> {
    await this.initialize();

    const { pageSize = 50 } = options;

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    try {
      const result = await this.people.people.searchContacts({
        query,
        pageSize,
        readMask: this.DEFAULT_PERSON_FIELDS,
      });

      return result.data.results?.map((r) => r.person).filter(Boolean) || [];
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to search contacts: ${error.message}`);
      }
      throw error;
    }
  }

  async findContactByEmail(email: string): Promise<Person | null> {
    const contacts = await this.searchContacts(email);
    return (
      contacts.find(
        (c) =>
          c.emailAddresses?.some(
            (e) => e.value?.toLowerCase() === email.toLowerCase()
          )
      ) || null
    );
  }

  async findContactByName(name: string): Promise<Person | null> {
    const contacts = await this.searchContacts(name);
    return (
      contacts.find(
        (c) =>
          c.names?.some(
            (n) =>
              n.displayName?.toLowerCase().includes(name.toLowerCase()) ||
              n.givenName?.toLowerCase().includes(name.toLowerCase()) ||
              n.familyName?.toLowerCase().includes(name.toLowerCase())
          )
      ) || null
    );
  }

  async createContact(contactData: CreateContactOptions): Promise<Person> {
    await this.initialize();

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    const person: any = {};

    if (contactData.firstName || contactData.lastName) {
      person.names = [
        {
          givenName: contactData.firstName,
          familyName: contactData.lastName,
        },
      ];
    }

    if (contactData.nickname) {
      person.nicknames = [{ value: contactData.nickname }];
    }

    if (contactData.email) {
      person.emailAddresses = [{ value: contactData.email }];
    }

    if (contactData.phone) {
      person.phoneNumbers = [{ value: contactData.phone }];
    }

    if (contactData.organization) {
      person.organizations = [{ name: contactData.organization }];
      if (contactData.jobTitle) {
        person.organizations[0].title = contactData.jobTitle;
      }
    }

    if (contactData.address) {
      person.addresses = [{ formattedValue: contactData.address }];
    }

    if (contactData.biography) {
      person.biographies = [{ value: contactData.biography }];
    }

    try {
      const result = await this.people.people.createContact({
        requestBody: { person },
      });

      if (!result.data) {
        throw new Error("No contact data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to create contact: ${error.message}`);
      }
      throw error;
    }
  }

  async updateContact(
    resourceName: string,
    contactData: CreateContactOptions
  ): Promise<Person> {
    await this.initialize();

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    const fullResourceName = this.parseResourceName(resourceName);

    // First, get the current contact
    const currentContact = await this.getContact(fullResourceName);

    // Build the updated person object
    const person: any = { ...currentContact };

    if (contactData.firstName || contactData.lastName) {
      person.names = person.names || [];
      person.names[0] = person.names[0] || {};
      if (contactData.firstName) person.names[0].givenName = contactData.firstName;
      if (contactData.lastName) person.names[0].familyName = contactData.lastName;
    }

    if (contactData.nickname) {
      person.nicknames = [{ value: contactData.nickname }];
    }

    if (contactData.email) {
      person.emailAddresses = [{ value: contactData.email }];
    }

    if (contactData.phone) {
      person.phoneNumbers = [{ value: contactData.phone }];
    }

    if (contactData.organization) {
      person.organizations = person.organizations || [];
      person.organizations[0] = person.organizations[0] || {};
      person.organizations[0].name = contactData.organization;
      if (contactData.jobTitle) {
        person.organizations[0].title = contactData.jobTitle;
      }
    }

    if (contactData.address) {
      person.addresses = [{ formattedValue: contactData.address }];
    }

    if (contactData.biography) {
      person.biographies = [{ value: contactData.biography }];
    }

    try {
      const result = await this.people.people.updateContact({
        resourceName: fullResourceName,
        requestBody: { person },
        updatePersonFields: this.DEFAULT_PERSON_FIELDS,
      });

      if (!result.data) {
        throw new Error("No contact data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to update contact: ${error.message}`);
      }
      throw error;
    }
  }

  async deleteContact(resourceName: string): Promise<{ success: boolean }> {
    await this.initialize();

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    const fullResourceName = this.parseResourceName(resourceName);

    try {
      await this.people.people.deleteContact({
        resourceName: fullResourceName,
      });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to delete contact: ${error.message}`);
      }
      throw error;
    }
  }

  async getContactGroups(): Promise<ContactGroup[]> {
    await this.initialize();

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    try {
      const result = await this.people.contactGroups.list();
      return result.data.contactGroups || [];
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to list contact groups: ${error.message}`);
      }
      throw error;
    }
  }

  async createContactGroup(name: string): Promise<ContactGroup> {
    await this.initialize();

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    try {
      const result = await this.people.contactGroups.create({
        requestBody: {
          contactGroup: {
            name,
          },
        },
      });

      if (!result.data) {
        throw new Error("No contact group data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to create contact group: ${error.message}`);
      }
      throw error;
    }
  }

  async deleteContactGroup(resourceName: string): Promise<{ success: boolean }> {
    await this.initialize();

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    const fullResourceName = this.parseResourceName(resourceName);

    try {
      await this.people.contactGroups.delete({
        resourceName: fullResourceName,
      });
      return { success: true };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to delete contact group: ${error.message}`);
      }
      throw error;
    }
  }

  async getMyProfile(): Promise<Person> {
    await this.initialize();

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    try {
      const result = await this.people.people.get({
        resourceName: "people/me",
        personFields: this.DEFAULT_PERSON_FIELDS,
      });

      if (!result.data) {
        throw new Error("No profile data returned");
      }
      return result.data;
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to get profile: ${error.message}`);
      }
      throw error;
    }
  }

  async batchCreateContacts(contactsData: CreateContactOptions[]): Promise<Person[]> {
    const created: Person[] = [];
    const BATCH_SIZE = 5;
    const DELAY_MS = 100;

    for (let i = 0; i < contactsData.length; i += BATCH_SIZE) {
      const batch = contactsData.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map((data) => this.createContact(data).catch(() => null))
      );

      created.push(...results.filter((r) => r !== null) as Person[]);

      if (i + BATCH_SIZE < contactsData.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    return created;
  }

  async batchDeleteContacts(resourceNames: string[]): Promise<{ deletedContacts: number }> {
    let deleted = 0;
    const BATCH_SIZE = 5;
    const DELAY_MS = 100;

    for (let i = 0; i < resourceNames.length; i += BATCH_SIZE) {
      const batch = resourceNames.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (rn) => {
          try {
            await this.deleteContact(rn);
            deleted++;
          } catch (error) {
            // Silently fail for individual delete errors
          }
        })
      );

      if (i + BATCH_SIZE < resourceNames.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    return { deletedContacts: deleted };
  }

  async addContactsToGroup(
    groupResourceName: string,
    contactResourceNames: string[]
  ): Promise<{ addedContacts: number }> {
    await this.initialize();

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    const fullGroupName = this.parseResourceName(groupResourceName);
    const fullContactNames = contactResourceNames.map((r) =>
      this.parseResourceName(r)
    );

    try {
      await this.people.contactGroups.members.modify({
        resourceName: fullGroupName,
        requestBody: {
          resourceNamesToAdd: fullContactNames,
        },
      });

      return { addedContacts: fullContactNames.length };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to add contacts to group: ${error.message}`);
      }
      throw error;
    }
  }

  async removeContactsFromGroup(
    groupResourceName: string,
    contactResourceNames: string[]
  ): Promise<{ removedContacts: number }> {
    await this.initialize();

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    const fullGroupName = this.parseResourceName(groupResourceName);
    const fullContactNames = contactResourceNames.map((r) =>
      this.parseResourceName(r)
    );

    try {
      await this.people.contactGroups.members.modify({
        resourceName: fullGroupName,
        requestBody: {
          resourceNamesToRemove: fullContactNames,
        },
      });

      return { removedContacts: fullContactNames.length };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to remove contacts from group: ${error.message}`);
      }
      throw error;
    }
  }

  async getContactsInGroup(
    groupResourceName: string,
    options: ListContactsOptions = {}
  ): Promise<{ contacts: Person[] }> {
    await this.initialize();

    if (!this.people) {
      throw new Error("Contacts service not initialized");
    }

    const fullGroupName = this.parseResourceName(groupResourceName);
    const { pageSize = 50, pageToken = null } = options;

    try {
      const result = await this.people.contactGroups.get({
        resourceName: fullGroupName,
        maxMembers: pageSize,
      });

      const memberResourceNames = result.data.memberResourceNames || [];

      // Fetch contact details for each member
      const contacts: Person[] = [];
      for (const resourceName of memberResourceNames) {
        try {
          const contact = await this.getContact(resourceName);
          contacts.push(contact);
        } catch (error) {
          // Silently skip contacts that can't be fetched
        }
      }

      return { contacts };
    } catch (error: unknown) {
      if (error instanceof Error) {
        throw new Error(`Failed to get contacts in group: ${error.message}`);
      }
      throw error;
    }
  }
}
