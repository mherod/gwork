/**
 * Google Contacts (People API) service wrapper.
 * Provides methods for managing contacts, contact groups, duplicate detection,
 * data quality analysis, and marketing contact detection.
 */

import { google } from "googleapis";
import { BaseService } from "./base-service.ts";
import { handleGoogleApiError } from "./error-handler.ts";
import { withRetry } from "./retry.ts";
import {
  validateEmail,
  validatePageSize,
  validateResourceId,
  validateMaxResults,
  validateConfidenceScore,
} from "./validators.ts";
import type {
  PeopleClient,
  Person,
  ContactGroup,
  ListContactsOptions,
  SearchContactsOptions,
  CreateContactOptions,
} from "../types/google-apis.ts";
import type { people_v1 } from "googleapis";

export class ContactsService extends BaseService {
  private people: PeopleClient | null = null;

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
    super(
      "Contacts",
      [
        "https://www.googleapis.com/auth/contacts",
        "https://www.googleapis.com/auth/contacts.readonly",
        "https://www.googleapis.com/auth/contacts.other.readonly",
      ],
      account
    );
  }

  /**
   * Initialize the service: authenticate and set up People API client.
   * Overrides BaseService.initialize() to initialize the people client.
   *
   * @throws {InitializationError} If credentials missing or authentication fails
   */
  override async initialize(): Promise<void> {
    await super.initialize();
    this.ensureInitialized();
    // Initialize People API client - auth is guaranteed non-null after ensureInitialized()
    this.people = google.people({ version: "v1", auth: this.getAuth() });
  }

  /**
   * Parses resource name, adding "people/" prefix if missing.
   *
   * @param input - Resource name (with or without prefix)
   * @returns Full resource name with "people/" prefix
   */
  private parseResourceName(input: string): string {
    return input.startsWith("people/") ? input : `people/${input}`;
  }

  // ============= CORE CONTACT OPERATIONS =============

  /**
   * Lists contacts with optional pagination and sorting.
   *
   * @param options - Optional parameters
   * @param options.pageSize - Number of contacts per page (1-2000, default: 50)
   * @param options.pageToken - Token for fetching next page
   * @param options.sortOrder - Sort order: "LAST_NAME_ASCENDING" (default) or "FIRST_NAME_ASCENDING"
   *
   * @returns Array of Person objects
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If pageSize is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const contacts = new ContactsService();
   * await contacts.initialize();
   *
   * // Get first page
   * const firstPage = await contacts.listContacts({ pageSize: 100 });
   *
   * // Get next page
   * const nextPage = await contacts.listContacts({
   *   pageSize: 100,
   *   pageToken: result.nextPageToken
   * });
   * ```
   */
  async listContacts(options: ListContactsOptions = {}): Promise<Person[]> {
    await this.initialize();
    this.ensureInitialized();

    const { pageSize = 50, pageToken = null, sortOrder = "LAST_NAME_ASCENDING" } = options;

    if (pageSize > 0) {
      validatePageSize(pageSize, 2000);
    }

    try {
      return await withRetry(
        async () => {
          const result = await this.people!.people.connections.list({
            resourceName: "people/me",
            pageSize,
            pageToken: pageToken || undefined,
            personFields: this.DEFAULT_PERSON_FIELDS,
            sortOrder: sortOrder as people_v1.Params$Resource$People$Connections$List["sortOrder"],
          });

          return result.data.connections || [];
        },
        { maxRetries: 3 }
      );
    } catch (error: unknown) {
      handleGoogleApiError(error, "list contacts");
    }
  }

  /**
   * Gets a single contact by resource name.
   *
   * @param resourceName - Contact resource name (with or without "people/" prefix)
   * @returns Person object with full contact details
   * @throws {NotFoundError} If contact not found
   * @throws {PermissionDeniedError} If user lacks access
   * @throws {ValidationError} If resourceName is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const contact = await contacts.getContact("people/1234567890");
   * const contact2 = await contacts.getContact("1234567890"); // Auto-prefixes
   * ```
   */
  async getContact(resourceName: string): Promise<Person> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(resourceName, "resourceName");

    const fullResourceName = this.parseResourceName(resourceName);

    try {
      const result = await this.people!.people.get({
        resourceName: fullResourceName,
        personFields: this.DEFAULT_PERSON_FIELDS,
      });

      if (!result.data) {
        throw new Error("No contact data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "get contact");
    }
  }

  /**
   * Searches contacts by query string.
   *
   * @param query - Search query (searches names, emails, etc.)
   * @param options - Optional parameters
   * @param options.pageSize - Number of results (1-2000, default: 50)
   *
   * @returns Array of matching Person objects
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If pageSize is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const results = await contacts.searchContacts("john");
   * const emailResults = await contacts.searchContacts("john@example.com", { pageSize: 100 });
   * ```
   */
  async searchContacts(query: string, options: SearchContactsOptions = {}): Promise<Person[]> {
    await this.initialize();
    this.ensureInitialized();

    const { pageSize = 50 } = options;

    if (pageSize > 0) {
      validatePageSize(pageSize, 2000);
    }

    try {
      return await withRetry(
        async () => {
          const result = await this.people!.people.searchContacts({
            query,
            pageSize,
            readMask: this.DEFAULT_PERSON_FIELDS,
          });

          return (
            result.data.results?.map((r) => r.person).filter((p) => p !== undefined) as Person[] || []
          );
        },
        { maxRetries: 3 }
      );
    } catch (error: unknown) {
      handleGoogleApiError(error, "search contacts");
    }
  }

  /**
   * Finds a contact by email address.
   *
   * @param email - Email address to search for
   * @returns Person object if found, null otherwise
   * @throws {ValidationError} If email format is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const contact = await contacts.findContactByEmail("john@example.com");
   * if (contact) {
   *   console.log(`Found: ${contact.names?.[0]?.displayName}`);
   * }
   * ```
   */
  async findContactByEmail(email: string): Promise<Person | null> {
    validateEmail(email);
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

  /**
   * Finds a contact by name (searches display name, given name, family name).
   *
   * @param name - Name to search for (partial match)
   * @returns Person object if found, null otherwise
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const contact = await contacts.findContactByName("John");
   * const smith = await contacts.findContactByName("Smith");
   * ```
   */
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

  /**
   * Creates a new contact.
   *
   * @param contactData - Contact information
   * @param contactData.firstName - First name
   * @param contactData.lastName - Last name
   * @param contactData.nickname - Nickname
   * @param contactData.email - Email address (validated)
   * @param contactData.phone - Phone number
   * @param contactData.organization - Organization name
   * @param contactData.jobTitle - Job title
   * @param contactData.address - Address (formatted)
   * @param contactData.biography - Biography/notes
   *
   * @returns Created Person object
   * @throws {ValidationError} If email format is invalid
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const contact = await contacts.createContact({
   *   firstName: "John",
   *   lastName: "Doe",
   *   email: "john@example.com",
   *   phone: "+1234567890",
   *   organization: "Acme Corp"
   * });
   * ```
   */
  async createContact(contactData: CreateContactOptions): Promise<Person> {
    await this.initialize();
    this.ensureInitialized();

    // Validate email if provided
    if (contactData.email) {
      validateEmail(contactData.email);
    }

    // Build typed person object (no 'as any')
    const person: Partial<Person> = {};

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
      const org: people_v1.Schema$Organization = { name: contactData.organization };
      if (contactData.jobTitle) {
        org.title = contactData.jobTitle;
      }
      person.organizations = [org];
    }

    if (contactData.address) {
      person.addresses = [{ formattedValue: contactData.address }];
    }

    if (contactData.biography) {
      person.biographies = [{ value: contactData.biography }];
    }

    try {
      const result = await this.people!.people.createContact({
        requestBody: person as people_v1.Schema$Person,
      });

      // Handle the union return type - result could be void or response
      if (!result || typeof result !== "object" || !("data" in result) || !result.data) {
        throw new Error("No contact data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "create contact");
    }
  }

  /**
   * Updates an existing contact.
   *
   * @param resourceName - Contact resource name to update
   * @param contactData - Fields to update (same as createContact)
   * @returns Updated Person object
   * @throws {NotFoundError} If contact not found
   * @throws {ValidationError} If email format is invalid
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const updated = await contacts.updateContact("people/123", {
   *   email: "newemail@example.com",
   *   phone: "+1987654321"
   * });
   * ```
   */
  async updateContact(
    resourceName: string,
    contactData: CreateContactOptions
  ): Promise<Person> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(resourceName, "resourceName");

    // Validate email if provided
    if (contactData.email) {
      validateEmail(contactData.email);
    }

    const fullResourceName = this.parseResourceName(resourceName);

    // Get current contact
    const currentContact = await this.getContact(fullResourceName);

    // Build updated person object (typed, no 'as any')
    const person: Partial<Person> = { ...currentContact };

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
      const result = await this.people!.people.updateContact({
        resourceName: fullResourceName,
        requestBody: person as people_v1.Schema$Person,
        updatePersonFields: this.DEFAULT_PERSON_FIELDS,
      });

      // Handle the union return type - result could be void or response
      if (!result || typeof result !== "object" || !("data" in result) || !result.data) {
        throw new Error("No contact data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "update contact");
    }
  }

  /**
   * Deletes a contact.
   *
   * @param resourceName - Contact resource name to delete
   * @returns Success indicator
   * @throws {NotFoundError} If contact not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If resourceName is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * await contacts.deleteContact("people/1234567890");
   * ```
   */
  async deleteContact(resourceName: string): Promise<{ success: boolean }> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(resourceName, "resourceName");

    const fullResourceName = this.parseResourceName(resourceName);

    try {
      await this.people!.people.deleteContact({
        resourceName: fullResourceName,
      });
      return { success: true };
    } catch (error: unknown) {
      handleGoogleApiError(error, "delete contact");
    }
  }

  // ============= CONTACT GROUP OPERATIONS =============

  /**
   * Lists all contact groups.
   *
   * @returns Array of ContactGroup objects
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const groups = await contacts.getContactGroups();
   * ```
   */
  async getContactGroups(): Promise<ContactGroup[]> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.people!.contactGroups.list();
      return result.data.contactGroups || [];
    } catch (error: unknown) {
      handleGoogleApiError(error, "list contact groups");
    }
  }

  /**
   * Creates a new contact group.
   *
   * @param name - Group name
   * @returns Created ContactGroup object
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If name is empty
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const group = await contacts.createContactGroup("Work Contacts");
   * ```
   */
  async createContactGroup(name: string): Promise<ContactGroup> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(name, "group name");

    try {
      const result = await this.people!.contactGroups.create({
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
      handleGoogleApiError(error, "create contact group");
    }
  }

  /**
   * Deletes a contact group.
   *
   * @param resourceName - Group resource name to delete
   * @returns Success indicator
   * @throws {NotFoundError} If group not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {ValidationError} If resourceName is invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * await contacts.deleteContactGroup("contactGroups/123");
   * ```
   */
  async deleteContactGroup(resourceName: string): Promise<{ success: boolean }> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(resourceName, "resourceName");

    const fullResourceName = this.parseResourceName(resourceName);

    try {
      await this.people!.contactGroups.delete({
        resourceName: fullResourceName,
      });
      return { success: true };
    } catch (error: unknown) {
      handleGoogleApiError(error, "delete contact group");
    }
  }

  /**
   * Adds contacts to a group.
   *
   * @param groupResourceName - Group to add contacts to
   * @param contactResourceNames - Array of contact resource names to add
   * @returns Count of contacts added
   * @throws {NotFoundError} If group or contacts not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const result = await contacts.addContactsToGroup(
   *   "contactGroups/123",
   *   ["people/456", "people/789"]
   * );
   * console.log(`Added ${result.addedContacts} contacts`);
   * ```
   */
  async addContactsToGroup(
    groupResourceName: string,
    contactResourceNames: string[]
  ): Promise<{ addedContacts: number }> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(groupResourceName, "groupResourceName");

    const fullGroupName = this.parseResourceName(groupResourceName);
    const fullContactNames = contactResourceNames.map((r) => this.parseResourceName(r));

    try {
      await this.people!.contactGroups.members.modify({
        resourceName: fullGroupName,
        requestBody: {
          resourceNamesToAdd: fullContactNames,
        },
      });

      return { addedContacts: fullContactNames.length };
    } catch (error: unknown) {
      handleGoogleApiError(error, "add contacts to group");
    }
  }

  /**
   * Removes contacts from a group.
   *
   * @param groupResourceName - Group to remove contacts from
   * @param contactResourceNames - Array of contact resource names to remove
   * @returns Count of contacts removed
   * @throws {NotFoundError} If group or contacts not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const result = await contacts.removeContactsFromGroup(
   *   "contactGroups/123",
   *   ["people/456"]
   * );
   * ```
   */
  async removeContactsFromGroup(
    groupResourceName: string,
    contactResourceNames: string[]
  ): Promise<{ removedContacts: number }> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(groupResourceName, "groupResourceName");

    const fullGroupName = this.parseResourceName(groupResourceName);
    const fullContactNames = contactResourceNames.map((r) => this.parseResourceName(r));

    try {
      await this.people!.contactGroups.members.modify({
        resourceName: fullGroupName,
        requestBody: {
          resourceNamesToRemove: fullContactNames,
        },
      });

      return { removedContacts: fullContactNames.length };
    } catch (error: unknown) {
      handleGoogleApiError(error, "remove contacts from group");
    }
  }

  /**
   * Gets all contacts in a group.
   *
   * @param groupResourceName - Group resource name
   * @param options - Optional parameters
   * @param options.pageSize - Max contacts to return (default: 50)
   * @returns Object with contacts array
   * @throws {NotFoundError} If group not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const { contacts } = await contacts.getContactsInGroup("contactGroups/123");
   * ```
   */
  async getContactsInGroup(
    groupResourceName: string,
    options: ListContactsOptions = {}
  ): Promise<{ contacts: Person[] }> {
    await this.initialize();
    this.ensureInitialized();
    validateResourceId(groupResourceName, "groupResourceName");

    const fullGroupName = this.parseResourceName(groupResourceName);
    const { pageSize = 50 } = options;

    try {
      const result = await this.people!.contactGroups.get({
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
          this.logger.debug(`Failed to fetch contact ${resourceName}`, { error });
        }
      }

      return { contacts };
    } catch (error: unknown) {
      handleGoogleApiError(error, "get contacts in group");
    }
  }

  // ============= PROFILE & BATCH OPERATIONS =============

  /**
   * Gets the user's own profile (people/me).
   *
   * @returns Person object representing user's profile
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const profile = await contacts.getMyProfile();
   * console.log(`Name: ${profile.names?.[0]?.displayName}`);
   * ```
   */
  async getMyProfile(): Promise<Person> {
    await this.initialize();
    this.ensureInitialized();

    try {
      const result = await this.people!.people.get({
        resourceName: "people/me",
        personFields: this.DEFAULT_PERSON_FIELDS,
      });

      if (!result.data) {
        throw new Error("No profile data returned");
      }
      return result.data;
    } catch (error: unknown) {
      handleGoogleApiError(error, "get profile");
    }
  }

  /**
   * Creates multiple contacts in batches (with rate limiting).
   *
   * @param contactsData - Array of contact data objects
   * @returns Array of created Person objects
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const contacts = await contacts.batchCreateContacts([
   *   { firstName: "John", email: "john@example.com" },
   *   { firstName: "Jane", email: "jane@example.com" }
   * ]);
   * ```
   */
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

  /**
   * Deletes multiple contacts in batches (with rate limiting).
   *
   * @param resourceNames - Array of contact resource names to delete
   * @returns Count of successfully deleted contacts
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const result = await contacts.batchDeleteContacts([
   *   "people/123",
   *   "people/456"
   * ]);
   * console.log(`Deleted ${result.deletedContacts} contacts`);
   * ```
   */
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
            this.logger.debug(`Failed to delete contact ${rn}`, { error });
          }
        })
      );

      if (i + BATCH_SIZE < resourceNames.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    return { deletedContacts: deleted };
  }

  // ============= DUPLICATE DETECTION =============

  /**
   * Calculates Levenshtein distance between two strings.
   * Used for fuzzy name matching in duplicate detection.
   *
   * @param str1 - First string
   * @param str2 - Second string
   * @returns Edit distance (0 = identical, higher = more different)
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len2; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len1; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i <= len2; i++) {
      for (let j = 1; j <= len1; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i]![j] = matrix[i - 1]![j - 1]!;
        } else {
          matrix[i]![j] = Math.min(
            matrix[i - 1]![j - 1]! + 1,
            matrix[i]![j - 1]! + 1,
            matrix[i - 1]![j]! + 1
          );
        }
      }
    }

    return matrix[len2]![len1]!;
  }

  /**
   * Normalizes name for comparison (lowercase, trim, remove special chars).
   *
   * @param name - Name to normalize
   * @returns Normalized name string
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s]/g, "");
  }

  /**
   * Calculates name similarity percentage (0-100).
   *
   * @param name1 - First name
   * @param name2 - Second name
   * @returns Similarity percentage (100 = identical)
   */
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

  /**
   * Extracts primary email from contact.
   *
   * @param contact - Person object
   * @returns Email address (lowercase) or null
   */
  private getContactEmail(contact: Person): string | null {
    return contact.emailAddresses?.[0]?.value?.toLowerCase() || null;
  }

  /**
   * Extracts primary phone from contact (digits only).
   *
   * @param contact - Person object
   * @returns Phone number (digits only) or null
   */
  private getContactPhone(contact: Person): string | null {
    return contact.phoneNumbers?.[0]?.value?.replace(/\D/g, "") || null;
  }

  /**
   * Extracts display name from contact.
   *
   * @param contact - Person object
   * @returns Display name or null
   */
  private getContactName(contact: Person): string | null {
    return contact.names?.[0]?.displayName || null;
  }

  /**
   * Finds duplicate contacts using multiple detection strategies.
   *
   * Uses three-phase detection:
   * 1. Exact email matches (100% confidence)
   * 2. Exact phone matches (100% confidence)
   * 3. Fuzzy name matching using Levenshtein distance (configurable threshold)
   *
   * @param options - Detection options
   * @param options.criteria - Detection criteria: "email", "phone", "name" (default: all)
   * @param options.threshold - Name similarity threshold 0-100 (default: 80)
   * @param options.maxResults - Max contacts to analyze (default: 1000)
   *
   * @returns Object with duplicates array, total counts, and confidence scores
   * @throws {ValidationError} If threshold or maxResults are invalid
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * // Find all duplicates
   * const result = await contacts.findDuplicates();
   *
   * // Find only email duplicates
   * const emailDups = await contacts.findDuplicates({
   *   criteria: ["email"],
   *   threshold: 95
   * });
   *
   * // Find name duplicates with high confidence
   * const nameDups = await contacts.findDuplicates({
   *   criteria: ["name"],
   *   threshold: 90,
   *   maxResults: 500
   * });
   * ```
   */
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

    // Validate inputs
    if (threshold < 0 || threshold > 100) {
      validateConfidenceScore(threshold);
    }
    if (maxResults > 0) {
      validateMaxResults(maxResults, 10000, 1);
    }

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
      for (let i = 0; i < contacts.length; i++) {
        for (let j = i + 1; j < contacts.length; j++) {
          const contact1 = contacts[i]!;
          const contact2 = contacts[j]!;

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

  /**
   * Merges multiple source contacts into a target contact.
   *
   * Merges:
   * - Email addresses (deduplicated)
   * - Phone numbers (deduplicated)
   * - Addresses (deduplicated)
   * - Other fields from target contact (preserved)
   *
   * @param sourceResourceNames - Array of source contact resource names to merge
   * @param targetResourceName - Target contact resource name (receives merged data)
   * @param options - Merge options
   * @param options.deleteAfterMerge - Delete source contacts after merge (default: true)
   *
   * @returns Object with merged contact, source contacts, and deleted contact names
   * @throws {NotFoundError} If any contact not found
   * @throws {PermissionDeniedError} If user lacks permissions
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const result = await contacts.mergeContacts(
   *   ["people/456", "people/789"],
   *   "people/123",
   *   { deleteAfterMerge: true }
   * );
   * console.log(`Merged ${result.sourceContacts.length} contacts`);
   * ```
   */
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
    this.ensureInitialized();

    const targetContact = await this.getContact(targetResourceName);
    const sourceContacts = await Promise.all(
      sourceResourceNames.map((rn) => this.getContact(rn))
    );

    // Merge contact data (typed, no 'as any')
    const mergedData: Partial<Person> = { ...targetContact };

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
    const updated = await this.updateContact(targetResourceName, mergedData as CreateContactOptions);

    // Delete source contacts if requested
    const deletedContacts: string[] = [];
    if (options.deleteAfterMerge !== false) {
      for (const sourceContact of sourceContacts) {
        try {
          if (sourceContact.resourceName) {
            await this.deleteContact(sourceContact.resourceName);
            deletedContacts.push(sourceContact.resourceName);
          }
        } catch (error) {
          // Continue even if deletion fails
          this.logger.debug(`Failed to delete source contact ${sourceContact.resourceName}`, { error });
        }
      }
    }

    return {
      mergedContact: updated,
      sourceContacts,
      deletedContacts,
    };
  }

  /**
   * Automatically merges duplicate contacts found by findDuplicates().
   *
   * @param options - Auto-merge options
   * @param options.criteria - Detection criteria (default: ["email"])
   * @param options.threshold - Confidence threshold (default: 95)
   * @param options.maxResults - Max contacts to analyze (default: 1000)
   * @param options.dryRun - If true, returns what would be merged without actually merging
   *
   * @returns Object with merge operation count and results
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * // Dry run to see what would be merged
   * const dryRun = await contacts.autoMergeDuplicates({ dryRun: true });
   * console.log(`Would merge ${dryRun.mergeOperations} groups`);
   *
   * // Actually merge duplicates
   * const result = await contacts.autoMergeDuplicates({
   *   criteria: ["email"],
   *   threshold: 95
   * });
   * ```
   */
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

      const target = duplicate.contacts[0]!;
      const sources = duplicate.contacts.slice(1);

      if (!target.resourceName) continue;

      const sourceNames = sources
        .map((c) => c.resourceName)
        .filter((rn) => rn) as string[];

      if (sourceNames.length === 0) continue;

      if (!dryRun) {
        try {
          await this.mergeContacts(sourceNames, target.resourceName!, {
            deleteAfterMerge: true,
          });
          results.push({
            target: target.resourceName!,
            sources: sourceNames,
            success: true,
          });
          mergeCount++;
        } catch (error) {
          results.push({
            target: target.resourceName!,
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

  /**
   * Extracts full name from contact (given + middle + family).
   *
   * @param contact - Person object
   * @returns Full name string or null
   */
  private getFullName(contact: Person): string | null {
    const names = contact.names?.[0];
    if (!names) return null;

    const parts: string[] = [];
    if (names.givenName) parts.push(names.givenName);
    if (names.middleName) parts.push(names.middleName);
    if (names.familyName) parts.push(names.familyName);

    return parts.length > 0 ? parts.join(" ") : null;
  }

  /**
   * Checks if name matches generic patterns (e.g., "Contact", "Home", "Test").
   *
   * @param name - Name to check
   * @returns True if name is generic
   */
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

  /**
   * Extracts surname hints from contact metadata (email, organization, phone).
   *
   * @param contact - Person object
   * @returns Array of hint strings
   */
  private extractSurnameHints(contact: Person): string[] {
    const hints: string[] = [];

    // Try to extract surname from email
    if (contact.emailAddresses?.[0]?.value) {
      const email = contact.emailAddresses[0].value;
      const localPart = email.split("@")[0]!;
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

  /**
   * Checks if contact appears to be auto-imported (generic patterns).
   *
   * @param contact - Person object
   * @returns True if likely imported
   */
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

    const isAutoGenName = importedPatterns.some((pattern) => pattern.test(name));
    const isAutoGenEmail = importedPatterns.some((pattern) => pattern.test(email));

    // Check for minimal data
    const hasMinimalData =
      !contact.emailAddresses ||
      (contact.emailAddresses.length === 1 && !contact.phoneNumbers) ||
      !contact.organizations;

    // Check if name matches email pattern
    const nameMatchesEmail =
      name.toLowerCase().replace(/\s/g, "") === email.split("@")[0]!.toLowerCase();

    return isAutoGenName || (isAutoGenEmail && hasMinimalData) || nameMatchesEmail;
  }

  /**
   * Finds contacts with missing first or last names.
   *
   * @param options - Options
   * @param options.pageSize - Max contacts to analyze (default: 100)
   * @returns Object with contacts missing names and analysis metadata
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const result = await contacts.findContactsWithMissingNames();
   * console.log(`Found ${result.contactsWithIssues} contacts with missing names`);
   * ```
   */
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
          email: contact.emailAddresses?.[0]?.value ?? undefined,
          phone: contact.phoneNumbers?.[0]?.value ?? undefined,
          organization: contact.organizations?.[0]?.name ?? undefined,
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

  /**
   * Finds contacts with generic names (e.g., "Contact", "Home", "Test").
   *
   * @param options - Options
   * @param options.pageSize - Max contacts to analyze (default: 100)
   * @returns Object with contacts having generic names
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const result = await contacts.findContactsWithGenericNames();
   * ```
   */
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
          email: contact.emailAddresses?.[0]?.value ?? undefined,
          phone: contact.phoneNumbers?.[0]?.value ?? undefined,
          organization: contact.organizations?.[0]?.name ?? undefined,
          surnameHints: hints,
        });
      }

      // Also check if full name is generic (and it's the only name)
      if (!familyName && this.isGenericName(givenName)) {
        const hints = this.extractSurnameHints(contact);
        contactsWithGenericNames.push({
          resourceName: contact.resourceName || "",
          displayName,
          email: contact.emailAddresses?.[0]?.value ?? undefined,
          phone: contact.phoneNumbers?.[0]?.value ?? undefined,
          organization: contact.organizations?.[0]?.name ?? undefined,
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

  /**
   * Analyzes contacts to identify likely auto-imported entries.
   *
   * @param options - Options
   * @param options.pageSize - Max contacts to analyze (default: 100)
   * @returns Object with imported contacts and confidence scores
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const result = await contacts.analyzeImportedContacts();
   * console.log(`Found ${result.importedContacts} likely imported contacts`);
   * ```
   */
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
      const displayName = contact.names?.[0]?.displayName || "Unknown";

      // Use isLikelyImportedContact to detect imported contacts
      if (this.isLikelyImportedContact(contact)) {
        const name = this.getFullName(contact) || "";
        const email = contact.emailAddresses?.[0]?.value || "";

        let issueType = "";
        let confidence = 0;

        // Determine specific type and confidence level
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
        } else {
          issueType = "Likely imported contact";
          confidence = 50;
        }

        if (confidence > 0) {
          importedContacts.push({
            resourceName: contact.resourceName || "",
            displayName,
            email: contact.emailAddresses?.[0]?.value ?? undefined,
            phone: contact.phoneNumbers?.[0]?.value ?? undefined,
            organization: contact.organizations?.[0]?.name ?? undefined,
            issueType,
            confidence,
          });
        }
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

  /**
   * Analyzes email address for marketing patterns.
   *
   * @param email - Email address to analyze
   * @returns Object with isMarketing flag, confidence score, and reasons
   */
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

    const localPart = email.split("@")[0]!.toLowerCase();
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
      const alias = email.split("+")[1]?.split("@")[0]?.toLowerCase() || "";
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

  /**
   * Analyzes name for marketing patterns.
   *
   * @param name - Name to analyze
   * @returns Object with isMarketing flag, confidence score, and reasons
   */
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

  /**
   * Analyzes contact for marketing patterns (email + name + heuristics).
   *
   * @param contact - Person object to analyze
   * @returns Object with isMarketing flag, confidence score, and reasons
   */
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

  /**
   * Detects marketing contacts using email patterns, name patterns, and heuristics.
   *
   * @param options - Options
   * @param options.pageSize - Max contacts to analyze (default: 200)
   * @returns Object with marketing contacts, confidence scores, and detection reasons
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const result = await contacts.detectMarketingContacts();
   * console.log(`Found ${result.marketingContacts} marketing contacts`);
   *
   * // Review high-confidence detections
   * const highConfidence = result.contacts.filter(c => c.confidence >= 80);
   * ```
   */
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
          email: contact.emailAddresses?.[0]?.value ?? undefined,
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

  /**
   * Deletes multiple marketing contacts.
   *
   * @param contacts - Array of contact objects with resourceName
   * @returns Object with deletion counts and failed contacts
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const marketing = await contacts.detectMarketingContacts();
   * const result = await contacts.cleanupMarketingContacts(marketing.contacts);
   * console.log(`Deleted ${result.deleted} marketing contacts`);
   * ```
   */
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
