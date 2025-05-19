import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SiteLocation, SiteLocationDocument } from '../location/schemas/site-location.schema';
import { v4 as uuidv4 } from 'uuid';

export const formatResponse = (
  status: 'success' | 'error',
  statusCode: number,
  message: string,
  data: any = null
) => ({
  status,
  statusCode,
  message,
  data,
});

@Injectable()
export class SiteLocationService {
  constructor(
    @InjectModel(SiteLocation.name)
    private siteLocationModel: Model<SiteLocationDocument>,
  ) { }

  async getAll(): Promise<any> {
    try {
      const locations = await this.siteLocationModel.find({
        $or: [
          { deletedAt: null },
          { deletedAt: { $exists: false } }
        ]
      }).exec();
      return formatResponse('success', 200, 'Site locations retrieved successfully', locations);
    } catch (error) {
      throw new InternalServerErrorException('Failed to retrieve site locations');
    }
  }


  async get(id: string): Promise<any> {
    try {
      const location = await this.siteLocationModel.findById(id);
      if (!location) throw new NotFoundException('Site not found');
      return formatResponse('success', 200, 'Site found', location);
    } catch (error) {
      throw error instanceof NotFoundException
        ? error
        : new InternalServerErrorException('Failed to retrieve site location');
    }
  }

  async getByName(name: string): Promise<any> {
    try {
      const location = await this.siteLocationModel.findOne({ name });
      if (!location) throw new NotFoundException('Site not found');
      return formatResponse('success', 200, 'Site found', location);
    } catch (error) {
      throw error instanceof NotFoundException
        ? error
        : new InternalServerErrorException('Failed to retrieve site location by name');
    }
  }

  async registerSiteLocation(
    siteName: string,
    sitePolygon: { lat: number; lng: number }[],
    siteCity: string,
  ): Promise<any> {
    try {
      const newLocation = new this.siteLocationModel({
        id: uuidv4(),
        siteName,
        sitePolygon,
        siteCity,
      });
      const savedLocation = await newLocation.save();
      return formatResponse('success', 201, 'Site location registered successfully', savedLocation);
    } catch (error) {
      throw new InternalServerErrorException('Failed to register site location');
    }
  }

  async softDeleteSiteLocation(id: string): Promise<any> {
    try {
      const updated = await this.siteLocationModel.findByIdAndUpdate(id,
        { $set: { deletedAt: new Date() } },
        { new: true }
      );

      if (!updated) {
        throw new NotFoundException('Site location not found or already deleted');
      }

      return formatResponse('success', 200, 'Site location soft deleted successfully', updated);
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Failed to soft delete site location');
    }
  }

}
