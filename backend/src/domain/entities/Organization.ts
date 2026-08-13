export type SubscriptionPlan = 'FREE' | 'PROFESSIONAL' | 'ENTERPRISE';
export type SubscriptionStatus = 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELLED' | 'SUSPENDED';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  logoDataUri: string | null;
  country: string;
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateOrganizationInput = Pick<
  Organization,
  'name' | 'slug' | 'country' | 'legalName'
>;
