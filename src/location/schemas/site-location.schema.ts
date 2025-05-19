import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { LatLng, LatLngSchema } from './lag-lng.schema';

export type SiteLocationDocument = HydratedDocument<SiteLocation>;

@Schema()
export class SiteLocation {

    @Prop({ required: true })
    siteName: string;

    @Prop({ required: false })
    siteCity: string;

    @Prop({ type: [LatLngSchema], required: true })
    sitePolygon: LatLng[];

    @Prop({ type: Date, default: null, index: true })
    deletedAt?: Date | null;
}

export const SiteLocationSchema = SchemaFactory.createForClass(SiteLocation);
