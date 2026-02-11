/**
 * Contact group management operations.
 * Handles creating, deleting, and managing contact groups.
 */

import type { PeopleClient, ContactGroup, Person } from "../types/google-apis.ts";
import { handleGoogleApiError } from "./error-handler.ts";
import { validateResourceId } from "./validators.ts";

export class ContactGroupManager {
  constructor(private people: PeopleClient, private onGetContact: (resourceName: string) => Promise<Person>) {}

  /**
   * Parses resource name, adding "people/" or "contactGroups/" prefix if missing.
   */
  private parseResourceName(input: string): string {
    // Check if it's a contact group resource
    if (input.startsWith("contactGroups/")) {
      return input;
    }
    if (input.startsWith("people/")) {
      return input;
    }
    // Heuristic: if it looks like a contact ID, add "people/" prefix
    // otherwise assume it's a group and add "contactGroups/" prefix
    return input.includes("/") || input.length > 20
      ? input.startsWith("people/") ? input : `people/${input}`
      : `contactGroups/${input}`;
  }

  /**
   * Lists all contact groups.
   */
  async getContactGroups(): Promise<ContactGroup[]> {
    try {
      const result = await this.people.contactGroups.list();
      return result.data.contactGroups || [];
    } catch (error: unknown) {
      handleGoogleApiError(error, "list contact groups");
    }
  }

  /**
   * Creates a new contact group.
   */
  async createContactGroup(name: string): Promise<ContactGroup> {
    validateResourceId(name, "group name");

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
      handleGoogleApiError(error, "create contact group");
    }
  }

  /**
   * Deletes a contact group.
   */
  async deleteContactGroup(resourceName: string): Promise<{ success: boolean }> {
    validateResourceId(resourceName, "resourceName");

    const fullResourceName = this.parseResourceName(resourceName);

    try {
      await this.people.contactGroups.delete({
        resourceName: fullResourceName,
      });
      return { success: true };
    } catch (error: unknown) {
      handleGoogleApiError(error, "delete contact group");
    }
  }

  /**
   * Adds contacts to a group.
   */
  async addContactsToGroup(
    groupResourceName: string,
    contactResourceNames: string[]
  ): Promise<{ addedContacts: number }> {
    validateResourceId(groupResourceName, "groupResourceName");

    const fullGroupName = this.parseResourceName(groupResourceName);
    const fullContactNames = contactResourceNames.map((r) => this.parseResourceName(r));

    try {
      await this.people.contactGroups.members.modify({
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
   */
  async removeContactsFromGroup(
    groupResourceName: string,
    contactResourceNames: string[]
  ): Promise<{ removedContacts: number }> {
    validateResourceId(groupResourceName, "groupResourceName");

    const fullGroupName = this.parseResourceName(groupResourceName);
    const fullContactNames = contactResourceNames.map((r) => this.parseResourceName(r));

    try {
      await this.people.contactGroups.members.modify({
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
   */
  async getContactsInGroup(
    groupResourceName: string,
    pageSize = 50
  ): Promise<{ contacts: Person[] }> {
    validateResourceId(groupResourceName, "groupResourceName");

    const fullGroupName = this.parseResourceName(groupResourceName);

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
          const contact = await this.onGetContact(resourceName);
          contacts.push(contact);
        } catch (_error) {
          // Silently skip contacts that can't be fetched
        }
      }

      return { contacts };
    } catch (error: unknown) {
      handleGoogleApiError(error, "get contacts in group");
    }
  }
}
