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
} from "./validators.ts";
import { ContactMatcher } from "./contact-matcher.ts";
import { ContactAnalyzer } from "./contact-analyzer.ts";
import { ContactGroupManager } from "./contact-group-manager.ts";
import type {
  PeopleClient,
  Person,
  ContactGroup,
  ListContactsOptions,
  SearchContactsOptions,
  CreateContactOptions,
} from "../types/google-apis.ts";
import type { people_v1 } from "googleapis";

export interface ContactsServiceDeps {
  matcher?: ContactMatcher;
  analyzer?: ContactAnalyzer;
}

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

  /** Minimal fields needed for duplicate detection — avoids fetching unused field groups. */
  private readonly DUPLICATE_DETECTION_FIELDS = "names,emailAddresses,phoneNumbers,metadata";

  // Composed service instances
  private matcher: ContactMatcher | null = null;
  private analyzer: ContactAnalyzer | null = null;
  private groupManager: ContactGroupManager | null = null;

  private readonly deps: ContactsServiceDeps;

  constructor(account = "default", deps: ContactsServiceDeps = {}) {
    super(
      "Contacts",
      [
        "https://www.googleapis.com/auth/contacts",
        "https://www.googleapis.com/auth/contacts.readonly",
        "https://www.googleapis.com/auth/contacts.other.readonly",
      ],
      account
    );
    this.deps = deps;
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

    // Use injected deps when provided, fall back to default implementations
    this.matcher = this.deps.matcher ?? new ContactMatcher();
    this.analyzer = this.deps.analyzer ?? new ContactAnalyzer();
    this.groupManager = new ContactGroupManager(this.people, (rn) => this.getContact(rn));
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

    const { pageSize = 50, pageToken = null, sortOrder = "LAST_NAME_ASCENDING", personFields } = options;

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
            personFields: personFields ?? this.DEFAULT_PERSON_FIELDS,
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
            result.data.results?.map((r) => r.person).filter((p): p is Person => p !== undefined) || []
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
    return this.groupManager!.getContactGroups();
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
    return this.groupManager!.createContactGroup(name);
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
    return this.groupManager!.deleteContactGroup(resourceName);
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
    return this.groupManager!.addContactsToGroup(groupResourceName, contactResourceNames);
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
    return this.groupManager!.removeContactsFromGroup(groupResourceName, contactResourceNames);
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
    const { pageSize = 50 } = options;
    return this.groupManager!.getContactsInGroup(groupResourceName, pageSize);
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
   * @returns Object with successfully created contacts and any per-item failures
   * @throws {InitializationError} If service not initialized
   *
   * @example
   * ```typescript
   * const { created, failures } = await contacts.batchCreateContacts([
   *   { firstName: "John", email: "john@example.com" },
   *   { firstName: "Jane", email: "jane@example.com" }
   * ]);
   * ```
   */
  async batchCreateContacts(contactsData: CreateContactOptions[]): Promise<{
    created: Person[];
    failures: { index: number; data: CreateContactOptions; error: unknown }[];
  }> {
    const created: Person[] = [];
    const failures: { index: number; data: CreateContactOptions; error: unknown }[] = [];
    const BATCH_SIZE = 5;
    const DELAY_MS = 100;

    for (let i = 0; i < contactsData.length; i += BATCH_SIZE) {
      const batch = contactsData.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (data, batchOffset) => {
          const globalIndex = i + batchOffset;
          try {
            const contact = await this.createContact(data);
            created.push(contact);
          } catch (error: unknown) {
            this.logger.debug(`Failed to create contact at index ${globalIndex}`, { error });
            failures.push({ index: globalIndex, data, error });
          }
        })
      );

      if (i + BATCH_SIZE < contactsData.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    return { created, failures };
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
    duplicates: {
      type: string;
      value: string;
      confidence: number;
      contacts: Person[];
    }[];
    totalDuplicates: number;
    totalContacts: number;
  }> {
    await this.initialize();

    const { maxResults = 1000 } = options;

    // Fetch contacts with only the fields needed for duplicate detection
    const contacts = await this.listContacts({ pageSize: maxResults, personFields: this.DUPLICATE_DETECTION_FIELDS });

    return this.matcher!.findDuplicates(contacts, {
      criteria: options.criteria,
      threshold: options.threshold,
    });
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

    // Use matcher to prepare merged data
    const mergedData = this.matcher!.prepareMergeData(targetContact, sourceContacts);

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
    results?: {
      target: string;
      sources: string[];
      success: boolean;
      error?: string;
    }[];
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

    const results: {
      target: string;
      sources: string[];
      success: boolean;
      error?: string;
    }[] = [];

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
    contacts: {
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      issueType: string;
      surnameHints: string[];
    }[];
    totalContacts: number;
    contactsWithIssues: number;
  }> {
    await this.initialize();

    const { pageSize = 100 } = options;

    const contacts = await this.listContacts({ pageSize });

    return this.analyzer!.findContactsWithMissingNames(contacts);
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
    contacts: {
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      surnameHints: string[];
    }[];
    totalContacts: number;
    contactsWithGenericNames: number;
  }> {
    await this.initialize();

    const { pageSize = 100 } = options;

    const contacts = await this.listContacts({ pageSize });

    return this.analyzer!.findContactsWithGenericNames(contacts);
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
    contacts: {
      resourceName: string;
      displayName: string;
      email?: string;
      phone?: string;
      organization?: string;
      issueType: string;
      confidence: number;
    }[];
    totalContacts: number;
    importedContacts: number;
  }> {
    await this.initialize();

    const { pageSize = 100 } = options;

    const contacts = await this.listContacts({ pageSize });

    return this.analyzer!.analyzeImportedContacts(contacts);
  }

  // ============= MARKETING DETECTION =============

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
    contacts: {
      resourceName: string;
      displayName: string;
      email?: string;
      detectionReasons: string[];
      confidence: number;
    }[];
    totalContacts: number;
    marketingContacts: number;
  }> {
    await this.initialize();

    const { pageSize = 200 } = options;

    const contacts = await this.listContacts({ pageSize });

    return this.analyzer!.detectMarketingContacts(contacts);
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
    contacts: { resourceName: string }[]
  ): Promise<{
    deleted: number;
    failed: number;
    failedContacts: { resourceName: string; error: string }[];
  }> {
    let deleted = 0;
    let failed = 0;
    const failedContacts: { resourceName: string; error: string }[] = [];

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
