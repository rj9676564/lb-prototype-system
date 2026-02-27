import PocketBase from 'pocketbase';

async function addRemarkField() {
    const pb = new PocketBase('http://127.0.0.1:9000');

    try {
        await pb.admins.authWithPassword('admin@admin.com', 'admin123456');
        
        const collection = await pb.collections.getOne('rp_prototype');
        
        // Check if remark field already exists
        const hasRemark = collection.fields.some(f => f.name === 'remark');
        
        if (!hasRemark) {
            collection.fields.push({
                name: "remark",
                type: "text",
                required: false,
                presentable: false,
                system: false,
                min: null,
                max: null,
                pattern: ""
            });
            
            await pb.collections.update(collection.id, collection);
            console.log('Successfully added remark field to rp_prototype');
        } else {
            console.log('Remark field already exists');
        }

    } catch (e) {
        console.error('Error modifying schema:', e);
    }
}

addRemarkField();
