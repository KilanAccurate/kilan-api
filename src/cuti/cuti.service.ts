// cuti.service.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { formatResponse } from '../helper/response.helper';
import { CutiDocument } from './schema/cuti.schema';
import { CreateCutiDto } from './dto/create-cuti.dto';
import { Role, User, UserDocument } from '../auth/model/user.model';
import { FcmService } from '../firebase/fcm/fcm.service';
import { ApprovalData } from '../absen/dto/absensi.dto';

@Injectable()
export class CutiService {
    constructor(
        @InjectModel('Cuti') private cutiModel: Model<CutiDocument>,
        @InjectModel(User.name) private userModel: Model<UserDocument>,
        private readonly fcmService: FcmService,
    ) { }

    async getCutiList(
        status: 'all' | 'pending' | 'approved' | 'rejected' = 'all',
        page = 1,
        limit = 25
    ): Promise<any> {
        try {
            const matchStage: any = {};

            switch (status) {
                case 'approved':
                    matchStage['pjoApproval'] = { $exists: true };
                    matchStage['pjoApproval.approvalStatus'] = 'approved';
                    break;
                case 'rejected':
                    matchStage['pjoApproval'] = { $exists: true };
                    matchStage['pjoApproval.approvalStatus'] = 'rejected';
                    break;
                case 'pending':
                    matchStage['pjoApproval'] = { $exists: false };
                    break;
                case 'all':
                default:
                    // no filter needed
                    break;
            }

            const skip = (page - 1) * limit;

            const [items, totalCount] = await Promise.all([
                this.cutiModel.aggregate([
                    { $match: matchStage },

                    // Step 1: Convert string IDs to ObjectIds
                    {
                        $addFields: {
                            pekerjaanDiserahkanPadaObjIds: {
                                $map: {
                                    input: { $ifNull: ["$pekerjaanDiserahkanPada", []] },
                                    as: "id",
                                    in: { $toObjectId: "$$id" },
                                },
                            },
                            accountId: { $toObjectId: "$accountId" },
                        },
                    },

                    // Step 2: Lookup user documents for the pekerjaanDiserahkanPada field
                    {
                        $lookup: {
                            from: "users",
                            let: { ids: "$pekerjaanDiserahkanPadaObjIds" },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: { $in: ["$_id", "$$ids"] },
                                    },
                                },
                                { $project: { password: 0 } },
                            ],
                            as: "pekerjaanDiserahkanPada",
                        },
                    },

                    // Step 3: Lookup user document for account
                    {
                        $lookup: {
                            from: "users",
                            let: { userId: "$accountId" },
                            pipeline: [
                                {
                                    $match: {
                                        $expr: { $eq: ["$_id", "$$userId"] },
                                    },
                                },
                                { $project: { password: 0 } },
                            ],
                            as: "account",
                        },
                    },

                    // Step 4: Unwind account (optional)
                    { $unwind: { path: "$account", preserveNullAndEmptyArrays: true } },

                    // Step 5: Pagination
                    { $skip: skip },
                    { $limit: limit },
                ]),
                this.cutiModel.countDocuments(matchStage),
            ]);


            const isMax = skip + items.length >= totalCount;

            return formatResponse('success', 200, `Cuti list retrieved (${status})`, {
                items,
                page,
                limit,
                totalCount,
                isMax,
            });
        } catch (error) {
            return formatResponse('error', 500, 'Failed to retrieve cuti list', error.message);
        }
    }

    async getCutiDetail(cutiId: string): Promise<any> {
        try {
            const cuti = await this.cutiModel.findById(cutiId).lean();

            if (!cuti) {
                return formatResponse('error', 404, 'Cuti not found');
            }

            return formatResponse('success', 200, 'Cuti detail retrieved', cuti);
        } catch (error) {
            return formatResponse('error', 500, 'Failed to retrieve cuti detail', error.message);
        }
    }

    async applyCuti(accountId: string, createCutiDto: CreateCutiDto): Promise<any> {
        // Handle FCM send notification to admin if cuti is applied
        try {
            const user = await this.userModel.findById(accountId);
            if (!user) {
                return formatResponse('error', 404, 'User not found');
            }
            const newCuti = new this.cutiModel({
                id: uuidv4(),
                accountId,
                ...createCutiDto,
            });
            const saved = await newCuti.save();
            let pjoList = await this.userModel.find(
                { 'site._id': user.site._id, role: Role.PJO },
                { fullName: 1, role: 1, fcmToken: 1 }
            );

            let managerList = await this.userModel.find(
                { role: Role.Manager },
                { fullName: 1, role: 1, fcmToken: 1 }
            );

            let hrdList = await this.userModel.find(
                { 'site._id': user.site._id, role: Role.HRD },
                { fullName: 1, role: 1, fcmToken: 1 }
            );

            let adminList = await this.userModel.find(
                { role: Role.Admin },
                { fullName: 1, role: 1, fcmToken: 1 }
            );

            let combinedSuperior = [
                ...pjoList,
                ...managerList,
                ...hrdList,
                ...adminList,
            ];
            await Promise.all(combinedSuperior.map(superior =>
                this.fcmService.sendNotification(
                    user._id.toString(),
                    superior._id.toString(),
                    `Pengajuan Cuti dari ${user.fullName}`,
                    `Hai ${superior.fullName}, ${user.fullName} telah mengajukan cuti.`,
                    {
                        'cutiId': saved._id.toString(),
                        'route': 'detail-cuti',
                        'type': 'cuti',
                        'userId': user._id.toString(),
                    },
                )
            ));

            return formatResponse('success', 201, 'Cuti applied successfully', saved);
        } catch (error) {
            return formatResponse('error', 500, 'Failed to apply cuti', error.message);
        }
    }

    async getUserCutiList(
        accountId: string,
        status: 'all' | 'pending' | 'approved' | 'rejected' = 'all',
        page = 1,
        limit = 25
    ): Promise<any> {
        try {
            const query: any = { accountId };

            switch (status) {
                case 'approved':
                    query['pjoApproval'] = { $exists: true };
                    query['pjoApproval.approvalStatus'] = 'approved';
                    break;
                case 'rejected':
                    query['pjoApproval'] = { $exists: true };
                    query['pjoApproval.approvalStatus'] = 'rejected';
                    break;
                case 'pending':
                    query['pjoApproval'] = { $exists: false };
                    break;
                case 'all':
                default:
                    // do not modify query
                    break;
            }

            const skip = (page - 1) * limit;
            const [totalCount, items] = await Promise.all([
                this.cutiModel.countDocuments(query),
                this.cutiModel.find(query)
                    .sort({ updatedAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .populate({
                        path: 'pekerjaanDiserahkanPada',
                        select: '-password', // exclude password
                    })
                    // Optionally populate accountId if needed:
                    // .populate({
                    //     path: 'accountId',
                    //     select: '-password',
                    // })
                    .lean(),
            ]);

            const isMax = skip + items.length >= totalCount;

            return formatResponse('success', 200, `Cuti list retrieved (${status})`, {
                items,
                page,
                limit,
                totalCount,
                isMax,
            });
        } catch (error) {
            return formatResponse('error', 500, 'Failed to retrieve cuti list', error.message);
        }
    }



    async getUserCutiDetail(accountId: string, cutiId: string): Promise<any> {
        try {
            const cuti = await this.cutiModel.findOne({ _id: cutiId, accountId }).lean();

            if (!cuti) {
                return formatResponse('error', 404, 'Cuti not found or unauthorized');
            }

            return formatResponse('success', 200, 'Cuti detail retrieved', cuti);
        } catch (error) {
            return formatResponse('error', 500, 'Failed to retrieve cuti detail', error.message);
        }
    }



    async actionCuti(accountId: string, approvalData: ApprovalData): Promise<any> {
        // TODO: Handle FCM approval send notification to user if approved/rejected
        try {

            const cuti = await this.cutiModel.findById(approvalData?.uid);
            const user = await this.userModel.findById(accountId);
            if (!user) {
                return formatResponse('error', 404, 'User not found');
            }
            const targetUser = await this.userModel.findById(cuti.accountId);
            if (!targetUser) {
                return formatResponse('error', 404, 'target user not found');
            }
            if (!cuti) return formatResponse('error', 404, 'Cuti not found');
            approvalData.role = user.role as 'pjo' | 'manager' | 'hrd';
            approvalData.userId = accountId;
            const updateField: Record<string, any> = {};
            switch (user.role) {
                case 'pjo':
                    updateField.pjoApproval = approvalData;
                    break;
                case 'manager':
                    updateField.managerApproval = approvalData;
                    break;
                case 'hrd':
                    updateField.hrdApproval = approvalData;
                    break;
                default:
                    return formatResponse('error', 400, 'Invalid role submitted');
            }


            const updated = await this.cutiModel.findByIdAndUpdate(
                approvalData.uid,
                { $set: updateField },
                { new: true }
            );

            let stats = approvalData.approvalStatus;
            this.fcmService.sendNotification(
                accountId,
                cuti.accountId,
                `Pengajuan Cuti anda ${stats === 'approved' ? 'disetujui' : 'ditolak'}`,
                `Hai ${targetUser.fullName}, pengajuan cuti anda telah ${stats === 'approved' ? 'disetujui' : 'ditolak'} oleh ${approvalData.role}.`,
                {
                    'cutiId': cuti._id.toString(),
                    'route': 'detail-cuti',
                    'type': 'cuti',
                    'userId': accountId.toString(),
                    'status': approvalData.approvalStatus,
                },
            );
            if (approvalData.role === 'pjo') {
                let managerList = await this.userModel.find(
                    { role: Role.Manager },
                    { fullName: 1, role: 1, fcmToken: 1 }
                );
                let hrdList = await this.userModel.find(
                    { role: Role.HRD },
                    { fullName: 1, role: 1, fcmToken: 1 }
                );

                await Promise.all([...managerList, ...hrdList].map(superior =>
                    this.fcmService.sendNotification(
                        accountId,
                        superior._id.toString(),
                        `Pengajuan Cuti oleh ${targetUser.fullName} telah ${stats === 'approved' ? 'disetujui' : 'ditolak'}`,
                        `Hai ${superior.fullName}, pengajuan cuti oleh ${targetUser.fullName} telah ${stats === 'approved' ? 'disetujui' : 'ditolak'} oleh ${approvalData.role}.`,
                        {
                            'cutiId': updateField._id.toString(),
                            'route': 'detail-cuti',
                            'type': 'cuti',
                            'userId': user._id.toString(),
                            'status': approvalData.approvalStatus,
                        },
                    )
                ));
            }
            return formatResponse('success', 200, 'Cuti approval updated', updated);
        } catch (error) {
            return formatResponse('error', 500, 'Failed to approve cuti', error.message);
        }
    }
}