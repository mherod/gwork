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

  // ============= DUPLICATE DETECTION =============

  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len2; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len1; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[len2][len1];
  }

  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s]/g, "");
  }

  private calculateNameSimilarity(name1: string, name2: string): number {
    const normalized1 = this.normalizeName(name1);
    const normalized2 = this.normalizeName(name2);

    if (normalized1 === normalized2) {
      return 100;
    }

    const maxLen = Math.max(normalized1.length, normalized2.length);
    if (maxLen === 0) return 0;

    const distance = this.levenshteinDistance(normalized1, normalized2);
    const similarity = ((maxLen - distance) / maxLen) * 100;

    return Math.round(similarity);
  }

  private getContactEmail(contact: Person): string | null {
    return contact.emailAddresses?.[0]?.value?.toLowerCase() || null;
  }

  private getContactPhone(contact: Person): string | null {
    return contact.phoneNumbers?.[0]?.value?.replace(/\D/g, "") || null;
  }

  private getContactName(contact: Person): string | null {
    return contact.names?.[0]?.displayName || null;
  }

  async findDuplicates(options: {
    criteria?: string[];
    threshold?: number;
    maxResults?: number;
  }): Promise<{
    duplicates: Array<{
      type: string;
      value: string;
      confidence: number;
      contacts: Person[];
    }>;
    totalDuplicates: number;
    totalContacts: number;
  }> {
    await this.initialize();

    const {
      criteria = ["email", "phone", "name"],
      threshold = 80,
      maxResults = 1000,
    } = options;

    // Fetch contacts
    const contacts = await this.listContacts({ pageSize: maxResults });

    if (contacts.length === 0) {
      return {
        duplicates: [],
        totalDuplicates: 0,
        totalContacts: 0,
      };
    }

    const duplicateGroups: Array<{
      type: string;
      value: string;
      confidence: number;
      contacts: Person[];
    }> = [];

    const processedPairs = new Set<string>();

    // Phase 1: Exact email matches (100% confidence)
    if (criteria.includes("email")) {
      const emailMap = new Map<string, Person[]>();

      contacts.forEach((contact) => {
        const email = this.getContactEmail(contact);
        if (email) {
          if (!emailMap.has(email)) {
            emailMap.set(email, []);
          }
          emailMap.get(email)!.push(contact);
        }
      });

      emailMap.forEach((emailContacts, email) => {
        if (emailContacts.length > 1) {
          const key = emailContacts.map((c) => c.resourceName).sort().join("|");
          if (!processedPairs.has(key)) {
            duplicateGroups.push({
              type: "email",
              value: email,
              confidence: 100,
              contacts: emailContacts,
            });
            processedPairs.add(key);
          }
        }
      });
    }

    // Phase 2: Exact phone matches (100% confidence)
    if (criteria.includes("phone")) {
      const phoneMap = new Map<string, Person[]>();

      contacts.forEach((contact) => {
        const phone = this.getContactPhone(contact);
        if (phone && phone.length >= 7) {
          if (!phoneMap.has(phone)) {
            phoneMap.set(phone, []);
          }
          phoneMap.get(phone)!.push(contact);
        }
      });

      phoneMap.forEach((phoneContacts, phone) => {
        if (phoneContacts.length > 1) {
          const key = phoneContacts.map((c) => c.resourceName).sort().join("|");
          if (!processedPairs.has(key)) {
            duplicateGroups.push({
              type: "phone",
              value: phone,
              confidence: 100,
              contacts: phoneContacts,
            });
            processedPairs.add(key);
          }
        }
      });
    }

    // Phase 3: Fuzzy name matching
    if (criteria.includes("name")) {
      const nameGroups = new Map<number, Person[][]>();

      for (let i = 0; i < contacts.length; i++) {
        for (let j = i + 1; j < contacts.length; j++) {
          const contact1 = contacts[i];
          const contact2 = contacts[j];

          const key = [contact1.resourceName, contact2.resourceName]
            .sort()
            .join("|");
          if (processedPairs.has(key)) {
            continue;
          }

          const name1 = this.getContactName(contact1);
          const name2 = this.getContactName(contact2);

          if (name1 && name2) {
            const similarity = this.calculateNameSimilarity(name1, name2);

            if (similarity >= threshold) {
              const group = [contact1, contact2];
              const confidence = similarity;

              duplicateGroups.push({
                type: "name",
                value: name1,
                confidence: Math.round(confidence),
                contacts: group,
              });
              processedPairs.add(key);
            }
          }
        }
      }
    }

    // Sort by confidence (descending)
    duplicateGroups.sort((a, b) => b.confidence - a.confidence);

    return {
      duplicates: duplicateGroups,
      totalDuplicates: duplicateGroups.length,
      totalContacts: contacts.length,
    };
  }

  async mergeContacts(
    sourceResourceNames: string[],
    targetResourceName: string,
    options: { deleteAfterMerge?: boolean } = {}
  ): Promise<{
    mergedContact: Person;
    sourceContacts: Person[];
    deletedContacts: string[];
  }> {
    await this.initialize();

    const targetContact = await this.getContact(targetResourceName);
    const sourceContacts = await Promise.all(
      sourceResourceNames.map((rn) => this.getContact(rn))
    );

    // Merge contact data
    const mergedData: any = { ...targetContact };

    // Merge emails
    const emails = new Set<string>();
    if (targetContact.emailAddresses) {
      targetContact.emailAddresses.forEach((e) => {
        if (e.value) emails.add(e.value);
      });
    }
    sourceContacts.forEach((c) => {
      c.emailAddresses?.forEach((e) => {
        if (e.value) emails.add(e.value);
      });
    });

    if (emails.size > 0) {
      mergedData.emailAddresses = Array.from(emails).map((email, idx) => ({
        value: email,
        metadata: { primary: idx === 0 },
      }));
    }

    // Merge phones
    const phones = new Set<string>();
    if (targetContact.phoneNumbers) {
      targetContact.phoneNumbers.forEach((p) => {
        if (p.value) phones.add(p.value);
      });
    }
    sourceContacts.forEach((c) => {
      c.phoneNumbers?.forEach((p) => {
        if (p.value) phones.add(p.value);
      });
    });

    if (phones.size > 0) {
      mergedData.phoneNumbers = Array.from(phones).map((phone, idx) => ({
        value: phone,
        metadata: { primary: idx === 0 },
      }));
    }

    // Merge addresses
    const addresses = new Set<string>();
    if (targetContact.addresses) {
      targetContact.addresses.forEach((a) => {
        if (a.formattedValue) addresses.add(a.formattedValue);
      });
    }
    sourceContacts.forEach((c) => {
      c.addresses?.forEach((a) => {
        if (a.formattedValue) addresses.add(a.formattedValue);
      });
    });

    if (addresses.size > 0) {
      mergedData.addresses = Array.from(addresses).map((addr, idx) => ({
        formattedValue: addr,
        metadata: { primary: idx === 0 },
      }));
    }

    // Update target contact with merged data
    const updated = await this.updateContact(targetResourceName, mergedData);

    // Delete source contacts
    const deletedContacts: string[] = [];
    for (const sourceContact of sourceContacts) {
      try {
        if (sourceContact.resourceName) {
          await this.deleteContact(sourceContact.resourceName);
          deletedContacts.push(sourceContact.resourceName);
        }
      } catch (error) {
        // Continue even if deletion fails
      }
    }

    return {
      mergedContact: updated,
      sourceContacts,
      deletedContacts,
    };
  }

  async autoMergeDuplicates(options: {
    criteria?: string[];
    threshold?: number;
    maxResults?: number;
    dryRun?: boolean;
  }): Promise<{
    mergeOperations: number;
    results?: Array<{
      target: string;
      sources: string[];
      success: boolean;
      error?: string;
    }>;
  }> {
    const {
      criteria = ["email"],
      threshold = 95,
      maxResults = 1000,
      dryRun = false,
    } = options;

    const duplicates = await this.findDuplicates({
      criteria,
      threshold,
      maxResults,
    });

    const results: Array<{
      target: string;
      sources: string[];
      success: boolean;
      error?: string;
    }> = [];

    let mergeCount = 0;

    for (const duplicate of duplicates.duplicates) {
      if (duplicate.contacts.length < 2) continue;

      const target = duplicate.contacts[0];
      const sources = duplicate.contacts.slice(1);

      if (!target.resourceName) continue;

      const sourceNames = sources
        .map((c) => c.resourceName)
        .filter((rn) => rn) as string[];

      if (sourceNames.length === 0) continue;

      if (!dryRun) {
        try {
          await this.mergeContacts(sourceNames, target.resourceName, {
            deleteAfterMerge: true,
          });
          results.push({
            target: target.resourceName,
            sources: sourceNames,
            success: true,
          });
          mergeCount++;
        } catch (error) {
          results.push({
            target: target.resourceName,
            sources: sourceNames,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } else {
        mergeCount++;
      }
    }

    return {
      mergeOperations: mergeCount,
      results: dryRun ? undefined : results,
    };
  }

  // ============= DATA QUALITY ANALYSIS =============

  private getFullName(contact: Person): string | null {
    const names = contact.names?.[0];
    if (!names) return null;

    const parts: string[] = [];
    if (names.givenName) parts.push(names.givenName);
    if (names.middleName) parts.push(names.middleName);
    if (names.familyName) parts.push(names.familyName);

    return parts.length > 0 ? parts.join(" ") : null;
  }

  private isGenericName(name: string): boolean {
    const genericPatterns = [
      /^contact$/i,
      /^contact \d+$/i,
      /^home$/i,
      /^work$/i,
      /^mobile$/i,
      /^phone$/i,
      /^email$/i,
      /^unknown$/i,
      /^unnamed$/i,
      /^noname$/i,
      /^test$/i,
      /^\d+$/,
      /^[a-z0-9]+@[a-z0-9]+\.[a-z]+$/i, // Email as name
      /^[+]?[\d\s\-()]+$/, // Phone as name
    ];

    return genericPatterns.some((pattern) => pattern.test(name.trim()));
  }

  private extractSurnameHints(contact: Person): string[] {
    const hints: string[] = [];

    // Try to extract surname from email
    if (contact.emailAddresses?.[0]?.value) {
      const email = contact.emailAddresses[0].value;
      const localPart = email.split("@")[0];
      const parts = localPart.split(/[._-]/);
      if (parts.length >= 2) {
        hints.push(`From email: ${parts[parts.length - 1]}`);
      }
    }

    // Try to extract from organization
    if (contact.organizations?.[0]?.name) {
      const org = contact.organizations[0].name;
      const lastWord = org.split(/\s+/).pop();
      if (lastWord && lastWord.length > 2) {
        hints.push(`From organization: ${lastWord}`);
      }
    }

    // Try to extract from phone if it looks like it has a name component
    if (contact.phoneNumbers?.[0]?.value) {
      const phone = contact.phoneNumbers[0].value;
      // Only if phone has non-numeric characters that might be a name
      const nonDigits = phone.replace(/[\d\s\-()]/g, "");
      if (nonDigits.length > 2) {
        hints.push(`From phone: ${nonDigits}`);
      }
    }

    return hints;
  }

  private isLikelyImportedContact(contact: Person): boolean {
    const name = this.getFullName(contact) || "";
    const email = contact.emailAddresses?.[0]?.value || "";

    // Auto-generated contact patterns
    const importedPatterns = [
      /^contact\d+/i,
      /^imported_/i,
      /^sync_/i,
      /^\d{5,}$/, // Just numbers as name
      /^test_/i,
      /^no.?name/i,
      /^[a-z0-9]+\+[a-z0-9]+@/i, // Gmail aliases
      /^noreply/i,
      /^do.?not.?reply/i,
      /^mailer/i,
      /^notification/i,
    ];

    const isAutoGenName = importedPatterns.some((pattern) =>
      pattern.test(name)
    );
    const isAutoGenEmail = importedPatterns.some((pattern) =>
      pattern.test(email)
    );

    // Check for minimal data
    const hasMinimalData =
      !contact.emailAddresses ||
      (contact.emailAddresses.length === 1 &&
        !contact.phoneNumbers) ||
      !contact.organizations;

    // Check if name matches email pattern
    const nameMatchesEmail =
      name.toLowerCase().replace(/\s/g, "") ===
      email.split("@")[0].toLowerCase();

    return isAutoGenName || (isAutoGenEmail && hasMinimalData) || nameMatchesEmail;
  }

  async findContactsWithMissingNames(options: {
    pageSize?: number;
  }): Promise<{
    contacts: Array<{
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      issueType: string;
      surnameHints: string[];
    }>;
    totalContacts: number;
    contactsWithIssues: number;
  }> {
    await this.initialize();

    const { pageSize = 100 } = options;

    const contacts = await this.listContacts({ pageSize });

    const contactsWithIssues: Array<{
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      issueType: string;
      surnameHints: string[];
    }> = [];

    contacts.forEach((contact) => {
      const fullName = this.getFullName(contact);
      const displayName = contact.names?.[0]?.displayName || "Unknown";

      // Check for missing first name
      const hasGivenName = !!contact.names?.[0]?.givenName;

      // Check for missing last name
      const hasFamilyName = !!contact.names?.[0]?.familyName;

      // Determine issue
      let issueType = "";
      if (!hasGivenName && !hasFamilyName) {
        issueType = "No first or last name";
      } else if (!hasGivenName) {
        issueType = "Missing first name";
      } else if (!hasFamilyName) {
        issueType = "Missing last name";
      }

      if (issueType) {
        const hints = this.extractSurnameHints(contact);
        contactsWithIssues.push({
          resourceName: contact.resourceName || "",
          displayName,
          email: contact.emailAddresses?.[0]?.value,
          phone: contact.phoneNumbers?.[0]?.value,
          organization: contact.organizations?.[0]?.name,
          issueType,
          surnameHints: hints,
        });
      }
    });

    return {
      contacts: contactsWithIssues,
      totalContacts: contacts.length,
      contactsWithIssues: contactsWithIssues.length,
    };
  }

  async findContactsWithGenericNames(options: {
    pageSize?: number;
  }): Promise<{
    contacts: Array<{
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      surnameHints: string[];
    }>;
    totalContacts: number;
    contactsWithGenericNames: number;
  }> {
    await this.initialize();

    const { pageSize = 100 } = options;

    const contacts = await this.listContacts({ pageSize });

    const contactsWithGenericNames: Array<{
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      surnameHints: string[];
    }> = [];

    contacts.forEach((contact) => {
      const displayName = contact.names?.[0]?.displayName || "Unknown";
      const familyName = contact.names?.[0]?.familyName || "";
      const givenName = contact.names?.[0]?.givenName || "";

      // Check if surname is generic
      if (familyName && this.isGenericName(familyName)) {
        const hints = this.extractSurnameHints(contact);
        contactsWithGenericNames.push({
          resourceName: contact.resourceName || "",
          displayName,
          email: contact.emailAddresses?.[0]?.value,
          phone: contact.phoneNumbers?.[0]?.value,
          organization: contact.organizations?.[0]?.name,
          surnameHints: hints,
        });
      }

      // Also check if full name is generic (and it's the only name)
      if (!familyName && this.isGenericName(givenName)) {
        const hints = this.extractSurnameHints(contact);
        contactsWithGenericNames.push({
          resourceName: contact.resourceName || "",
          displayName,
          email: contact.emailAddresses?.[0]?.value,
          phone: contact.phoneNumbers?.[0]?.value,
          organization: contact.organizations?.[0]?.name,
          surnameHints: hints,
        });
      }
    });

    return {
      contacts: contactsWithGenericNames,
      totalContacts: contacts.length,
      contactsWithGenericNames: contactsWithGenericNames.length,
    };
  }

  async analyzeImportedContacts(options: {
    pageSize?: number;
  }): Promise<{
    contacts: Array<{
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      issueType: string;
      confidence: number;
    }>;
    totalContacts: number;
    importedContacts: number;
  }> {
    await this.initialize();

    const { pageSize = 100 } = options;

    const contacts = await this.listContacts({ pageSize });

    const importedContacts: Array<{
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      issueType: string;
      confidence: number;
    }> = [];

    contacts.forEach((contact) => {
      const name = this.getFullName(contact) || "";
      const email = contact.emailAddresses?.[0]?.value || "";
      const displayName = contact.names?.[0]?.displayName || "Unknown";

      let issueType = "";
      let confidence = 0;

      // Check for auto-generated patterns
      if (name.toLowerCase().startsWith("contact")) {
        issueType = "Auto-generated 'Contact' name";
        confidence = 95;
      } else if (/^imported_|^sync_/.test(name.toLowerCase())) {
        issueType = "Auto-import identifier";
        confidence = 90;
      } else if (/^test_/i.test(name)) {
        issueType = "Test contact";
        confidence = 85;
      } else if (
        name.toLowerCase().match(/noreply|donotreply|mailer|notification/i)
      ) {
        issueType = "System-generated contact";
        confidence = 80;
      } else if (
        email &&
        email.match(/^[a-z0-9]+\+[a-z0-9]+@/i)
      ) {
        issueType = "Email alias (potential import artifact)";
        confidence = 60;
      } else if (!contact.phoneNumbers && !contact.organizations) {
        issueType = "Minimal data (email-only)";
        confidence = 40;
      }

      if (issueType && confidence > 0) {
        importedContacts.push({
          resourceName: contact.resourceName || "",
          displayName,
          email: contact.emailAddresses?.[0]?.value,
          phone: contact.phoneNumbers?.[0]?.value,
          organization: contact.organizations?.[0]?.name,
          issueType,
          confidence,
        });
      }
    });

    // Sort by confidence descending
    importedContacts.sort((a, b) => b.confidence - a.confidence);

    return {
      contacts: importedContacts,
      totalContacts: contacts.length,
      importedContacts: importedContacts.length,
    };
  }

  // ============= MARKETING DETECTION =============

  private isMarketingEmail(email: string): {
    isMarketing: boolean;
    confidence: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let confidence = 0;

    // Marketing service prefixes
    const marketingPrefixes = [
      "noreply",
      "no-reply",
      "do-not-reply",
      "donotreply",
      "marketing",
      "newsletter",
      "notifications",
      "notification",
      "noticias",
      "promo",
      "promotion",
      "promotional",
      "unsubscribe",
      "sales",
      "support",
      "help",
      "info",
      "contact",
      "hello",
      "team",
      "no.reply",
      "postmaster",
      "mailer",
      "mailbox",
      "bounce",
      "automated",
      "admin",
      "webmaster",
    ];

    // Marketing domains
    const marketingDomains = [
      "mailchimp.com",
      "sendgrid.net",
      "constantcontact.com",
      "aweber.com",
      "icontact.com",
      "getresponse.com",
      "convertkit.com",
      "klaviyo.com",
      "substack.com",
      "brevo.com",
      "sendpulse.com",
      "mailgun.org",
      "postmark.com",
      "sendwithus.com",
      "mandrill.com",
      "sparkpost.com",
      "elasticemail.com",
      "pepipost.com",
      "zoho.com",
      "mailblaze.com",
    ];

    const localPart = email.split("@")[0].toLowerCase();
    const domain = email.split("@")[1]?.toLowerCase() || "";

    // Check for marketing prefixes
    const hasMarketingPrefix = marketingPrefixes.some((prefix) =>
      localPart.startsWith(prefix)
    );

    if (hasMarketingPrefix) {
      reasons.push("Marketing prefix detected");
      confidence += 30;
    }

    // Check for marketing domains
    const hasMarketingDomain = marketingDomains.some((marketDomain) =>
      domain.includes(marketDomain)
    );

    if (hasMarketingDomain) {
      reasons.push("Marketing service domain");
      confidence += 50;
    }

    // Check for common patterns
    if (email.includes("noreply")) {
      reasons.push("'noreply' pattern");
      confidence += 35;
    }

    if (email.includes("newsletter")) {
      reasons.push("Newsletter address");
      confidence += 40;
    }

    if (email.includes("promo") || email.includes("promotion")) {
      reasons.push("Promotional email");
      confidence += 40;
    }

    if (email.includes("alert") || email.includes("notification")) {
      reasons.push("Alert/notification address");
      confidence += 20;
    }

    // Check for email aliases with marketing keywords
    if (email.includes("+")) {
      const alias = email.split("+")[1]?.split("@")[0].toLowerCase() || "";
      if (
        alias.includes("promo") ||
        alias.includes("news") ||
        alias.includes("offer")
      ) {
        reasons.push("Marketing alias detected");
        confidence += 25;
      }
    }

    return {
      isMarketing: confidence >= 30,
      confidence: Math.min(confidence, 100),
      reasons,
    };
  }

  private isMarketingName(name: string): {
    isMarketing: boolean;
    confidence: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let confidence = 0;

    const lowerName = name.toLowerCase();

    // Marketing-related names
    const marketingPatterns = [
      /newsletter/i,
      /marketing/i,
      /promotions?/i,
      /sales/i,
      /support/i,
      /noreply/i,
      /alerts?/i,
      /notifications?/i,
      /updates?/i,
      /announcements?/i,
      /no.?reply/i,
      /do.?not.?reply/i,
      /unsubscribe/i,
      /automated/i,
      /system/i,
      /postmaster/i,
      /mailer/i,
      /bounce/i,
      /webmaster/i,
      /helpdesk/i,
      /ticketing/i,
    ];

    marketingPatterns.forEach((pattern) => {
      if (pattern.test(lowerName)) {
        reasons.push(`Pattern: ${pattern.source}`);
        confidence += 20;
      }
    });

    // All caps (common for automated emails)
    if (lowerName !== name && /^[A-Z\s]+$/.test(name)) {
      reasons.push("All caps name (automated)");
      confidence += 15;
    }

    return {
      isMarketing: confidence >= 20,
      confidence: Math.min(confidence, 100),
      reasons,
    };
  }

  private isMarketingContact(contact: Person): {
    isMarketing: boolean;
    confidence: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let confidence = 0;

    // Check email
    if (contact.emailAddresses?.[0]?.value) {
      const emailAnalysis = this.isMarketingEmail(
        contact.emailAddresses[0].value
      );
      if (emailAnalysis.isMarketing) {
        confidence += emailAnalysis.confidence * 0.6;
        reasons.push(...emailAnalysis.reasons);
      }
    }

    // Check name
    const name = contact.names?.[0]?.displayName || "";
    if (name) {
      const nameAnalysis = this.isMarketingName(name);
      if (nameAnalysis.isMarketing) {
        confidence += nameAnalysis.confidence * 0.4;
        reasons.push(...nameAnalysis.reasons);
      }
    }

    // Heuristic: No phone, no organization, only email = likely marketing
    if (
      !contact.phoneNumbers &&
      !contact.organizations &&
      contact.emailAddresses?.length
    ) {
      confidence += 15;
      reasons.push("No phone/organization (email-only)");
    }

    // Heuristic: Multiple email addresses = potential mailing list
    if (contact.emailAddresses && contact.emailAddresses.length > 2) {
      confidence += 10;
      reasons.push("Multiple email addresses");
    }

    return {
      isMarketing: confidence >= 30,
      confidence: Math.min(confidence, 100),
      reasons: [...new Set(reasons)],
    };
  }

  async detectMarketingContacts(options: {
    pageSize?: number;
  }): Promise<{
    contacts: Array<{
      resourceName: string;
      displayName: string;
      email?: string;
      detectionReasons: string[];
      confidence: number;
    }>;
    totalContacts: number;
    marketingContacts: number;
  }> {
    await this.initialize();

    const { pageSize = 200 } = options;

    const contacts = await this.listContacts({ pageSize });

    const marketingContacts: Array<{
      resourceName: string;
      displayName: string;
      email?: string;
      detectionReasons: string[];
      confidence: number;
    }> = [];

    contacts.forEach((contact) => {
      const analysis = this.isMarketingContact(contact);

      if (analysis.isMarketing) {
        marketingContacts.push({
          resourceName: contact.resourceName || "",
          displayName: contact.names?.[0]?.displayName || "Unknown",
          email: contact.emailAddresses?.[0]?.value,
          detectionReasons: analysis.reasons,
          confidence: analysis.confidence,
        });
      }
    });

    // Sort by confidence descending
    marketingContacts.sort((a, b) => b.confidence - a.confidence);

    return {
      contacts: marketingContacts,
      totalContacts: contacts.length,
      marketingContacts: marketingContacts.length,
    };
  }

  async cleanupMarketingContacts(
    contacts: Array<{ resourceName: string }>
  ): Promise<{
    deleted: number;
    failed: number;
    failedContacts: Array<{ resourceName: string; error: string }>;
  }> {
    let deleted = 0;
    let failed = 0;
    const failedContacts: Array<{ resourceName: string; error: string }> = [];

    for (const contact of contacts) {
      try {
        await this.deleteContact(contact.resourceName);
        deleted++;
      } catch (error) {
        failed++;
        failedContacts.push({
          resourceName: contact.resourceName,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      deleted,
      failed,
      failedContacts,
    };
  }
}
