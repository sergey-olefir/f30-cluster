import cv2, numpy as np, json
exec(open('/Users/solefir/projects/f30-cluster/bake/src/C3/measure/measure.py').read().split('np.set_printoptions')[0])
for base,c,flip in [('17_physical-cluster_full.comfort.C3@2x',(80,628),0),('04_comfort_whole-cluster_mph.comfort.C3',(80,628),0),('07_physical-cluster_all-lamps-lit.comfort.C3',(80,628),0),('17_physical-cluster_full.comfort.C4',(1840,628),1),('04_comfort_whole-cluster_mph.comfort.C4',(1840,628),1)]:
    A,r,u=unwrap(base,*c,dA=0.5,nr=1060)
    if flip: u=u[:,::-1][:, np.r_[len(A)-1, 0:len(A)-1]]
    L=cv2.GaussianBlur(u.mean(2),(0,0),2)
    def fit(sel_a, r0, r1):
        As=[];Rs=[]
        for j in np.where(sel_a)[0]:
            m=(r>r0)&(r<r1); p=L[m,j]; i=np.argmax(p)
            if p[i]-np.median(p)>15: 
                # subpixel centroid
                w=np.clip(p-np.median(p),0,None); Rs.append((r[m]*w).sum()/w.sum()); As.append(A[j])
        As=np.radians(np.array(As)); Rs=np.array(Rs)
        M=np.c_[np.ones_like(As),np.sin(As),-np.cos(As)]
        sol,res,_,_=np.linalg.lstsq(M,Rs,rcond=None)
        return sol, np.sqrt(np.mean((M@sol-Rs)**2)), len(As)
    s1=fit((A>190)&(A<335),0.5,0.6)
    s2=fit(((A>130)&(A<360)) | (A<20),0.92,1.02)
    print(base[:2],base[-4:],'inner arc r0=%.4f dx=%.4f dy=%.4f rms=%.4f n=%d'%(*s1[0],s1[1],s1[2]), '| bezel r0=%.4f dx=%.4f dy=%.4f rms=%.4f'%(*s2[0],s2[1]))
print('--- ticks')
for base,c,flip in [('17_physical-cluster_full.comfort.C3@2x',(80,628),0),('04_comfort_whole-cluster_mph.comfort.C3',(80,628),0),('07_physical-cluster_all-lamps-lit.comfort.C3',(80,628),0),('17_physical-cluster_full.comfort.C4',(1840,628),1),('04_comfort_whole-cluster_mph.comfort.C4',(1840,628),1)]:
    A,r,u=unwrap(base,*c,dA=0.5,nr=1060)
    if flip: u=u[:,::-1][:, np.r_[len(A)-1, 0:len(A)-1]]
    L=u.mean(2)
    out=[];inn=[];angs=[];cen=[]
    for a in np.arange(151.15+9.65, 345, 9.65):
        if abs(((a-151.15)/9.65)%5)<0.01 or abs(((a-151.15)/9.65)%5-5)<0.01: continue
        if a<178: continue
        s=(A>a-4)&(A<a+4); m=(r>0.6)&(r<0.85)
        sub=L[m][:,s]; col=sub.max(1); bg=np.percentile(col,5); mx=col.max()
        rs=r[m][col>bg+0.5*(mx-bg)]
        ang_prof=sub.max(0); w=np.clip(ang_prof-np.percentile(ang_prof,20),0,None); ac=(A[s]*w).sum()/w.sum()
        out.append(rs.max()); inn.append(rs.min()); angs.append(a); cen.append(ac)
    As=np.radians(angs); M=np.c_[np.ones_like(As),np.sin(As),-np.cos(As)]
    so=np.linalg.lstsq(M,np.array(out),rcond=None)[0]; si=np.linalg.lstsq(M,np.array(inn),rcond=None)[0]
    print(base[:2],base[-4:],[(int(a),round(i,3),round(o,3)) for a,i,o in zip(angs,inn,out)])
    print('    angle centroid - nominal:', np.round(np.array(cen)-np.array(angs),1))
