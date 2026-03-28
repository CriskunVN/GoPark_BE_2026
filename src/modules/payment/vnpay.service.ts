import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as qs from 'qs';
import moment from 'moment';

@Injectable()
export class VnpayService {
  private readonly logger = new Logger(VnpayService.name);

  constructor(private configService: ConfigService) {}

  createPaymentUrl(amount: number, ipAddr: string, orderInfo: string, userId: string): string {
    const tmnCode = process.env.VNPAY_TMNCODE || this.configService.get<string>('VNPAY_TMNCODE') || '';
    const secretKey = process.env.VNPAY_HASHSECRET || this.configService.get<string>('VNPAY_HASHSECRET') || '';
    let vnpUrl = process.env.VNPAY_URL || this.configService.get<string>('VNPAY_URL') || '';
    const returnUrl = process.env.VNPAY_RETURN_URL || this.configService.get<string>('VNPAY_RETURN_URL') || '';

    const date = new Date();
    const createDate = moment(date).format('YYYYMMDDHHmmss');
    const orderId = moment(date).format('DDHHmmss');

    let vnp_Params: any = {};
    vnp_Params['vnp_Version'] = '2.1.0';
    vnp_Params['vnp_Command'] = 'pay';
    vnp_Params['vnp_TmnCode'] = tmnCode;
    vnp_Params['vnp_Locale'] = 'vn';
    vnp_Params['vnp_CurrCode'] = 'VND';
    vnp_Params['vnp_TxnRef'] = orderId;
    vnp_Params['vnp_OrderInfo'] = orderInfo;
    vnp_Params['vnp_OrderType'] = 'other'; // Đổi lại thành other cho an toàn
    vnp_Params['vnp_Amount'] = amount * 100; // VNPAY nhân 100
    vnp_Params['vnp_ReturnUrl'] = returnUrl;
    vnp_Params['vnp_IpAddr'] = ipAddr;
    vnp_Params['vnp_CreateDate'] = createDate;

    vnp_Params = this.sortObject(vnp_Params);

    const signData = qs.stringify(vnp_Params, { encode: false });
    const hmac = crypto.createHmac('sha512', secretKey);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
    vnp_Params['vnp_SecureHash'] = signed;
    vnpUrl += '?' + qs.stringify(vnp_Params, { encode: false });

    this.logger.log('--- VNPAY DEBUG ---');
    this.logger.log(`tmnCode: ${tmnCode}`);
    this.logger.log(`secretKey: ${secretKey}`);
    this.logger.log(`signData: ${signData}`);
    this.logger.log(`signed: ${signed}`);
    this.logger.log(`vnpUrl: ${vnpUrl}`);
    
    return vnpUrl;
  }

  verifyIpn(vnp_Params: any): any {
    let secureHash = vnp_Params['vnp_SecureHash'];
    const secretKey = process.env.VNPAY_HASHSECRET || this.configService.get<string>('VNPAY_HASHSECRET') || '';

    delete vnp_Params['vnp_SecureHash'];
    delete vnp_Params['vnp_SecureHashType'];

    vnp_Params = this.sortObject(vnp_Params);
    const signData = qs.stringify(vnp_Params, { encode: false });
    const hmac = crypto.createHmac('sha512', secretKey);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    if (secureHash === signed) {
      return { isSuccess: true, code: vnp_Params['vnp_ResponseCode'], message: 'success', vnp_Params };
    } else {
      return { isSuccess: false, code: '97', message: 'Fail checksum' };
    }
  }

  private sortObject(obj: any): any {
    let sorted: any = {};
    let str: string[] = [];
    let key;
    for (key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        str.push(encodeURIComponent(key));
      }
    }
    str.sort();
    for (key = 0; key < str.length; key++) {
      sorted[str[key]] = encodeURIComponent(obj[str[key]]).replace(/%20/g, '+');
    }
    return sorted;
  }
}
