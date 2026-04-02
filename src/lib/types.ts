export type EntityType = "individual" | "trust" | "company"

export type Parcel = {
  id: string
  ticker: string
  date: string        // ISO 8601
  units: number
  unitPrice: number   // AUD per unit
  brokerage: number   // AUD
  costBase: number    // computed: (units * unitPrice) + brokerage
  unitsRemaining: number
}

export type ParcelUsage = {
  parcelId: string
  units: number
  costBase: number
  acquisitionDate: string
  discountEligible: boolean
  grossGain: number
  discountedGain: number
}

export type Disposal = {
  id: string
  ticker: string
  date: string
  units: number
  unitPrice: number
  brokerage: number
  proceeds: number    // computed: (units * unitPrice) - brokerage
  method: "fifo" | "lifo" | "optimised"
  parcelsUsed: ParcelUsage[]
}

export type AppData = {
  entityType: EntityType
  parcels: Parcel[]
  disposals: Disposal[]
}
